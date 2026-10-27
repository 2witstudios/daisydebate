import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { OutboxRow } from '@daisy/db/outbox';
import { createDeliveryScheduler } from './delivery-scheduler';

setupRitewayBun();

let seq = 0n;
const row = (topic: string, createdAt = '2026-10-27T00:00:00.000Z') =>
  ({
    txid: '1',
    seq: (seq += 1n),
    topic,
    kind: 'channel.changed',
    version: 1,
    payload: {},
    createdAt,
  }) as OutboxRow;

/** A delivery whose settlement each test releases explicitly. */
function gatedDelivery() {
  const started: OutboxRow[] = [];
  const gates = new Map<OutboxRow, () => void>();
  return {
    started,
    deliver: (delivered: OutboxRow) => {
      started.push(delivered);
      const { promise, resolve } = Promise.withResolvers<void>();
      gates.set(delivered, resolve);
      return promise;
    },
    release: async (delivered: OutboxRow) => {
      gates.get(delivered)?.();
      // Drain every microtask: the settlement and the pump that follows it.
      await new Promise<void>((resolve) => setImmediate(resolve));
    },
  };
}

const limits = { maxRunningTopics: 2, maxPerTopic: 3, maxRetained: 6 };

test('a blocked topic cannot stall a healthy one', async () => {
  const gated = gatedDelivery();
  const scheduler = createDeliveryScheduler({
    ...limits,
    deliver: gated.deliver,
    overflow: () => {},
  });
  const blocked = row('channel:a');
  const healthy = [row('channel:b'), row('channel:b')];
  scheduler.enqueue([blocked, ...healthy]);
  await gated.release(healthy[0]!);
  assert({
    given: 'topic A whose delivery never settles and topic B with two rows',
    should: 'deliver both of B’s rows in order while A is still running',
    actual: gated.started.map(({ seq: position }) => position),
    expected: [blocked.seq, healthy[0]!.seq, healthy[1]!.seq],
  });
});

test('rows of one topic deliver one at a time, in order', async () => {
  const gated = gatedDelivery();
  const scheduler = createDeliveryScheduler({
    ...limits,
    deliver: gated.deliver,
    overflow: () => {},
  });
  const rows = [row('room:a'), row('room:a'), row('room:a')];
  scheduler.enqueue(rows);
  const before = gated.started.length;
  await gated.release(rows[0]!);
  await gated.release(rows[1]!);
  assert({
    given: 'three rows on one topic',
    should: 'start each only after its predecessor settled',
    actual: { before, order: gated.started.map(({ seq: s }) => s) },
    expected: { before: 1, order: rows.map(({ seq: s }) => s) },
  });
});

test('runnable topics take turns', async () => {
  const gated = gatedDelivery();
  const scheduler = createDeliveryScheduler({
    ...limits,
    maxRunningTopics: 1,
    deliver: gated.deliver,
    overflow: () => {},
  });
  const a = [row('t:a'), row('t:a')];
  const b = [row('t:b'), row('t:b')];
  scheduler.enqueue([a[0]!, a[1]!, b[0]!, b[1]!]);
  for (const next of [a[0]!, b[0]!, a[1]!]) await gated.release(next);
  assert({
    given: 'two saturated topics and one running slot',
    should: 'alternate topics after each row',
    actual: gated.started.map(({ topic }) => topic),
    expected: ['t:a', 't:b', 't:a', 't:b'],
  });
});

test('a topic past its bound is resynced and dropped, holding no work', async () => {
  const gated = gatedDelivery();
  const overflowed: string[] = [];
  const scheduler = createDeliveryScheduler({
    ...limits,
    deliver: gated.deliver,
    overflow: (topic) => overflowed.push(topic),
  });
  const running = row('t:a');
  scheduler.enqueue([running]);
  scheduler.enqueue([row('t:a'), row('t:a'), row('t:a')]);
  assert({
    given: 'a topic receiving one row more than its retained bound',
    should: 'signal resync for that topic once and retain only the running row',
    actual: { overflowed, backlog: scheduler.backlog(0) },
    expected: {
      overflowed: ['t:a'],
      backlog: { retained: 1, running: 1, topics: 1, oldestAgeMs: 0 },
    },
  });
});

test('sustained overload across many topics stays within the global bound', async () => {
  const gated = gatedDelivery();
  const overflowed = new Set<string>();
  const scheduler = createDeliveryScheduler({
    ...limits,
    deliver: gated.deliver,
    overflow: (topic) => overflowed.add(topic),
  });
  let peak = 0;
  for (let index = 0; index < 200; index += 1) {
    scheduler.enqueue([row(`t:${index % 20}`)]);
    peak = Math.max(peak, scheduler.backlog(0).retained);
  }
  assert({
    given: '200 rows over 20 topics with no delivery settling',
    should: 'never retain more than the global bound and resync the excess',
    actual: {
      peakWithinBound: peak <= limits.maxRetained,
      resynced: overflowed.size > 0,
    },
    expected: { peakWithinBound: true, resynced: true },
  });
});

test('the oldest publication age follows the injected wall clock and clears on settlement', async () => {
  const gated = gatedDelivery();
  const scheduler = createDeliveryScheduler({
    ...limits,
    deliver: gated.deliver,
    overflow: () => {},
  });
  const created = Date.parse('2026-10-27T00:00:00.000Z');
  const only = row('t:a', '2026-10-27T00:00:00.000Z');
  scheduler.enqueue([only]);
  const waiting = scheduler.backlog(created + 1500).oldestAgeMs;
  await gated.release(only);
  assert({
    given: 'one row published 1.5s ago, then its delivery settling',
    should: 'report 1500ms while it is retained and 0 once settled',
    actual: { waiting, settled: scheduler.backlog(created + 9000) },
    expected: {
      waiting: 1500,
      settled: { retained: 0, running: 0, topics: 0, oldestAgeMs: 0 },
    },
  });
});

test('a failed delivery still releases its slot', async () => {
  const delivered: string[] = [];
  const scheduler = createDeliveryScheduler({
    ...limits,
    maxRunningTopics: 1,
    deliver: async (next) => {
      delivered.push(next.topic);
      if (next.topic === 't:a') throw new Error('authority read failed');
    },
    overflow: () => {},
  });
  scheduler.enqueue([row('t:a'), row('t:b')]);
  await scheduler.settled();
  assert({
    given: 'a delivery that rejects',
    should: 'free its slot so the next topic runs, and settle',
    actual: { delivered, backlog: scheduler.backlog(0).retained },
    expected: { delivered: ['t:a', 't:b'], backlog: 0 },
  });
});

test('a batch that overflows a topic resyncs it once', () => {
  const overflowed: string[] = [];
  const scheduler = createDeliveryScheduler({
    ...limits,
    deliver: () => new Promise<void>(() => {}),
    overflow: (topic) => overflowed.push(topic),
  });
  scheduler.enqueue(Array.from({ length: 20 }, () => row('t:a')));
  assert({
    given: 'one batch of 20 rows for a topic bounded at 3',
    should: 'report the overflow once, not per rejected row',
    actual: overflowed,
    expected: ['t:a'],
  });
});

test('global pressure resyncs the topic that built the backlog, not a new arrival', () => {
  const overflowed: string[] = [];
  const scheduler = createDeliveryScheduler({
    maxRunningTopics: 1,
    maxPerTopic: 10,
    maxRetained: 6,
    deliver: () => new Promise<void>(() => {}),
    overflow: (topic) => overflowed.push(topic),
  });
  scheduler.enqueue([row('slow:a')]);
  scheduler.enqueue([
    row('slow:b'),
    row('slow:b'),
    row('slow:b'),
    row('slow:b'),
  ]);
  scheduler.enqueue([row('slow:c')]);
  scheduler.enqueue([row('quiet:d')]);
  assert({
    given:
      'a full global bound mostly held by one slow topic, then one row on a quiet topic',
    should: 'resync the slow topic and admit the quiet row',
    actual: { overflowed, retained: scheduler.backlog(0).retained },
    expected: { overflowed: ['slow:b'], retained: 3 },
  });
});
