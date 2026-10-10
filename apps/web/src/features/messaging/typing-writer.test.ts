import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createTypingWriter } from './typing-writer';
import { createTimerQueue } from '../realtime/connection-store.test-support';
setupRitewayBun();
test('renewal follows only current server timing and stops on unavailable acknowledgement or disposal', async () => {
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
        : new Response(null, { status: 503 });
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
  timers.advance(1000);
  assert({
    given: 'the bounded renewal fails with an unavailable HTTP response',
    should: 'perform the due renewal once and arm no unapproved retry timing',
    actual: sent,
    expected: [true, true],
  });
  await writer.close();
  await writer.close();
  await writer.activity(true);
  timers.advance(1000);
  assert({
    given: 'duplicate disposal and activity after the writer is closed',
    should: 'send exactly one stop without resurrecting renewal',
    actual: sent,
    expected: [true, true, false],
  });
});
