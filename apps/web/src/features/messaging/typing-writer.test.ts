import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createTypingWriter, TYPING_RETRY_MS } from './typing-writer';
import { createTimerQueue } from '../realtime/connection-store.test-support';
setupRitewayBun();

const channelId = 'c'.repeat(24);
/** A writer over queued timers whose nth write (1-based) answers `answer(n)`. */
const writerAnswering = (answer: (n: number) => Response | Error) => {
  const sent: boolean[] = [];
  const timers = createTimerQueue((clock, delay) => clock + delay);
  const writer = createTypingWriter({
    channelId,
    timers,
    write: async (value) => {
      sent.push(value);
      const reply = answer(sent.length);
      if (reply instanceof Error) throw reply;
      return reply;
    },
  });
  return { sent, timers, writer };
};
const renewIn = (refreshAfterMs: number, typing: boolean) =>
  Response.json({ version: 1, channelId, typing, refreshAfterMs });
test('renewal follows server timing, backs off only when refused as too soon, and stops on any other refusal or disposal', async () => {
  const { sent, timers, writer } = writerAnswering((n) =>
    n === 1
      ? renewIn(450, false)
      : new Response(null, { status: n === 2 ? 429 : 503 }),
  );
  await writer.activity(true);
  timers.advance(449);
  assert({
    given: 'an acknowledged start before the exact server renewal interval',
    should: 'send no early or keystroke-based renewal',
    actual: sent,
    expected: [true],
  });
  timers.advance(1);
  await writer.activity(true);
  await writer.activity(true);
  timers.advance(1000);
  const beforeRetry = [...sent];
  timers.advance(TYPING_RETRY_MS - 1000);
  await writer.activity(true);
  assert({
    given:
      'the bounded renewal refused as too soon (429), then keystrokes while it waits',
    should:
      'perform the due renewal once, post nothing per keystroke, and retry once after the back-off',
    actual: [beforeRetry, sent],
    expected: [
      [true, true],
      [true, true, true],
    ],
  });
  timers.advance(TYPING_RETRY_MS * 3);
  await writer.activity(true);
  await writer.activity(true);
  assert({
    given:
      'the retry refused as unavailable (503), not as too soon, then more keystrokes',
    should: 'stop renewing and post nothing per keystroke',
    actual: sent,
    expected: [true, true, true],
  });
  await writer.activity(false);
  await writer.activity(true);
  assert({
    given: 'the member stops and starts typing again after the stall',
    should: 'send the stop and try the start again',
    actual: sent,
    expected: [true, true, true, false, true],
  });
  await writer.close();
  await writer.close();
  await writer.activity(true);
  timers.advance(1000);
  assert({
    given: 'duplicate disposal and activity after the writer is closed',
    should: 'send exactly one stop without resurrecting renewal',
    actual: sent,
    expected: [true, true, true, false, true, false],
  });
});

test('a write the network dropped backs off once and retries, never stalls', async () => {
  const { sent, timers, writer } = writerAnswering((n) =>
    n === 1 ? new TypeError('Failed to fetch') : renewIn(5000, true),
  );
  await writer.activity(true);
  await writer.activity(true);
  timers.advance(TYPING_RETRY_MS);
  assert({
    given: 'a typing start the network dropped, then a keystroke',
    should: 'post nothing per keystroke and retry once after the back-off',
    actual: sent,
    expected: [true, true],
  });
  await writer.close();
});
