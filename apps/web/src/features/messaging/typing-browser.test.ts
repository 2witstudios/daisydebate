import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { ServerMessage } from '@daisy/protocol';
import { buildChannelTopic, ENVELOPE_VERSION } from '@daisy/protocol';
import { createTimerQueue } from '../realtime/connection-store.test-support';
import { attachTypingReader } from './typing-reader';
import { createTypingWriter } from './typing-writer';
setupRitewayBun();
const channelId = 'c'.repeat(24);
const body = (typing: boolean) => ({
  version: 1,
  channelId,
  typing,
  refreshAfterMs: 500,
});
test('browser writer serializes changed intent and coalesces keystrokes without content', async () => {
  const timers = createTimerQueue((now, ms) => now + ms),
    calls: boolean[] = [];
  const first = Promise.withResolvers<Response>();
  const writer = createTypingWriter({
    channelId,
    timers,
    write: async (typing) => {
      calls.push(typing);
      return calls.length === 1 ? first.promise : Response.json(body(false));
    },
  });
  const start = writer.activity(true);
  void writer.activity(true);
  const stop = writer.activity(false);
  first.resolve(Response.json(body(false)));
  await Promise.all([start, stop]);
  assert({
    given: 'multiple keystrokes then stop while start awaits',
    should:
      'perform only ordered boolean start/stop requests and arm no renewal after stop',
    actual: calls,
    expected: [true, false],
  });
  timers.advance(1000);
  assert({
    given: 'inactive draft after server acknowledgment',
    should: 'perform no lease refresh',
    actual: calls,
    expected: [true, false],
  });
  await writer.close();
});
test('browser reader refetches thin hints and expiry with no cursor or stale async resurrection', async () => {
  const timers = createTimerQueue((now, ms) => now + ms),
    projections: (boolean | null)[] = [];
  let emit: (frame: ServerMessage) => void = () => {},
    reads = 0;
  const pending = Promise.withResolvers<Response>(),
    shown = Promise.withResolvers<void>();
  const reader = attachTypingReader({
    channelId,
    timers,
    recoveryAfterMs: null,
    connection: {
      subscribeTopic: (_topic, callback) => {
        emit = callback;
        return () => {};
      },
      subscribe: () => () => {},
    },
    read: async () => {
      reads++;
      return reads === 1 ? Response.json(body(true)) : pending.promise;
    },
    publish: (value) => {
      projections.push(value);
      if (value === true) shown.resolve();
    },
  });
  await shown.promise;
  timers.advance(500);
  emit({
    v: ENVELOPE_VERSION,
    type: 'typing_changed',
    topic: buildChannelTopic(channelId),
  });
  reader.close();
  pending.resolve(Response.json(body(true)));
  await pending.promise;
  assert({
    given: 'explicit expiry refetch, thin hint and disposal while HTTP awaits',
    should: 'clear promptly and never let a closed observer restore typing',
    actual: [
      reads,
      projections.at(-1),
      projections.filter((value) => value === true).length,
    ],
    expected: [2, null, 1],
  });
});

test('initial failed typing HTTP recovers on the explicitly injected interval without any new socket hint', async () => {
  const timers = createTimerQueue((now, ms) => now + ms),
    failed = Promise.withResolvers<void>(),
    recovered = Promise.withResolvers<void>();
  let reads = 0;
  const values: (boolean | null)[] = [];
  const reader = attachTypingReader({
    channelId,
    timers,
    recoveryAfterMs: 700,
    connection: { subscribeTopic: () => () => {}, subscribe: () => () => {} },
    read: async () => {
      reads++;
      return reads === 1
        ? new Response(null, { status: 503 })
        : Response.json(body(true));
    },
    publish: (value) => {
      values.push(value);
      if (reads === 1 && value === null) failed.resolve();
      if (value === true) recovered.resolve();
    },
  });
  await failed.promise;
  await Promise.resolve();
  timers.advance(699);
  assert({
    given: 'initial unavailable projection before approved recovery interval',
    should: 'expose unknown and perform no early retry',
    actual: [reads, values.at(-1)],
    expected: [1, null],
  });
  timers.advance(1);
  // A bounded assertion exposes the missing timer without hanging the red control.
  assert({
    given: 'the explicit recovery interval elapsed with a stable socket',
    should: 'start a fresh authorized HTTP read even without a hint',
    actual: reads,
    expected: 2,
  });
  await recovered.promise;
  reader.close();
});
