import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  createTypingWriter,
  TYPING_RETRY_MAX_MS,
  TYPING_RETRY_MS,
} from './typing-writer';
import { createTimerQueue } from '../realtime/connection-store.test-support';
setupRitewayBun();

const channelId = 'c'.repeat(24);
/**
 * A writer over queued timers whose nth write (1-based) answers `answer(n)`.
 * `settled()` awaits the write the last fired timer started.
 */
const writerAnswering = (answer: (n: number) => Response | Error) => {
  const sent: boolean[] = [];
  const at: number[] = [];
  const queue = createTimerQueue((clock, delay) => clock + delay);
  let retry: unknown = undefined;
  const timers = {
    ...queue,
    setTimeout: (callback: () => void, ms: number) =>
      queue.setTimeout(() => {
        // The writer's callback answers its write's completion.
        retry = callback();
      }, ms),
  };
  const writer = createTypingWriter({
    channelId,
    timers,
    write: async (value) => {
      sent.push(value);
      at.push(queue.now());
      const reply = answer(sent.length);
      if (reply instanceof Error) throw reply;
      return reply;
    },
  });
  return {
    sent,
    at,
    timers: queue,
    writer,
    settled: () => Promise.resolve(retry),
  };
};
const renewIn = (refreshAfterMs: number, typing: boolean) =>
  Response.json({ version: 1, channelId, typing, refreshAfterMs });
test('renewal follows server timing, backs off when refused as too soon, and stalls on a refusal (4xx) or disposal', async () => {
  const { sent, timers, writer } = writerAnswering((n) =>
    n === 1
      ? renewIn(450, false)
      : new Response(null, { status: n === 2 ? 429 : 403 }),
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
    given: 'the retry refused outright (403), then more keystrokes',
    should: 'stop renewing and post nothing per keystroke',
    actual: sent,
    expected: [true, true, true],
  });
  await writer.activity(false);
  await writer.activity(true);
  assert({
    given: 'the member stops and starts typing again after the refusal',
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

test('transient failures back off doubling to a cap, honour Retry-After, and restart after an acknowledgement', async () => {
  const unavailable = () => new Response(null, { status: 503 });
  const answers: Record<number, () => Response | Error> = {
    1: () => new TypeError('Failed to fetch'),
    2: unavailable,
    3: () => new Response('<html>proxy</html>', { status: 200 }),
    4: () => new Response(null, { status: 408 }),
    5: unavailable,
    6: () => renewIn(5000, true),
    7: unavailable,
    8: () =>
      new Response(null, { status: 429, headers: { 'Retry-After': '10' } }),
  };
  const { at, timers, writer, settled } = writerAnswering(
    (n) => answers[n]?.() ?? renewIn(5000, true),
  );
  await writer.activity(true);
  for (let elapsed = 0; elapsed < 93_000; elapsed += 1000) {
    await writer.activity(true);
    timers.advance(1000);
    await settled();
  }
  assert({
    given:
      'a dropped start, a 503, an unparseable 2xx, a 408 and a 503, an acknowledgement, a 503, then a 429 with Retry-After, all under a keystroke every second',
    should:
      'post nothing per keystroke and wait 3, 6, 12 and 24 s, then the cap, the server bound, 3 s again, then the hinted 10 s',
    actual: at.slice(1).map((time, index) => time - at[index]!),
    expected: [
      TYPING_RETRY_MS,
      TYPING_RETRY_MS * 2,
      TYPING_RETRY_MS * 4,
      TYPING_RETRY_MS * 8,
      TYPING_RETRY_MAX_MS,
      5000,
      TYPING_RETRY_MS,
      10_000,
    ],
  });
  await writer.close();
});
