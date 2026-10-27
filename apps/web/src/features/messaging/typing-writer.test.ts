import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createTypingWriter, TYPING_RETRY_MS } from './typing-writer';
import { createTimerQueue } from '../realtime/connection-store.test-support';
setupRitewayBun();
test('renewal follows server timing, backs off only when refused as too soon, and stops on any other refusal or disposal', async () => {
  const channelId = 'c'.repeat(24),
    sent: boolean[] = [];
  const timers = createTimerQueue((clock, delay) => clock + delay);
  const writer = createTypingWriter({
    channelId,
    timers,
    write: async (value) => {
      sent.push(value);
      return sent.length === 1
        ? Response.json({
            version: 1,
            channelId,
            typing: false,
            refreshAfterMs: 450,
          })
        : new Response(null, { status: sent.length === 2 ? 429 : 503 });
    },
  });
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
  await writer.close();
  await writer.close();
  await writer.activity(true);
  timers.advance(1000);
  assert({
    given: 'duplicate disposal and activity after the writer is closed',
    should: 'send exactly one stop without resurrecting renewal',
    actual: sent,
    expected: [true, true, true, false],
  });
});
