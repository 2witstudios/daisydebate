import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { OutboxRow } from '@daisy/db/outbox';
import { deferred } from './outbox-drain.test-support';
import { fixture, row, topic } from './registry.test-support';

setupRitewayBun();

const otherId = 'e'.repeat(24);
const other = `room:${otherId}`;
const otherRow = (seq: number): OutboxRow => ({
  ...row(seq),
  topic: other,
  payload: { kind: 'room.changed', ids: [otherId], entityVersion: seq },
});
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

test('a topic blocked on authority cannot stall another topic', async () => {
  const blocked = deferred<{ revision: string; validUntil: number }>();
  let held = false;
  const { registry, connection, sent } = fixture({
    authorize: async (_principal, requested) => {
      if (requested === topic && held) return blocked.promise;
      return { revision: '1', validUntil: 60_000 };
    },
  });
  await registry.subscribe(connection, { id: 'a', topic });
  await registry.subscribe(connection, { id: 'b', topic: other });
  held = true;
  registry.sink([row(1), otherRow(2)]);
  await flush();
  const events = sent
    .filter((frame) => frame.type === 'event')
    .map((frame) => frame.type === 'event' && frame.topic);
  blocked.resolve({ revision: '1', validUntil: 60_000 });
  await registry.settled();
  assert({
    given: 'topic A whose event authorization hangs and topic B with a row',
    should: 'publish B’s event while A is still waiting',
    actual: events,
    expected: [other],
  });
});

test('a late allow after the topic overflowed cannot publish', async () => {
  const blocked = deferred<{ revision: string; validUntil: number }>();
  let held = false;
  const { registry, connection, sent, attached } = fixture({
    authorize: async () =>
      held ? blocked.promise : { revision: '1', validUntil: 60_000 },
  });
  await registry.subscribe(connection, { id: 'a', topic });
  held = true;
  registry.sink([row(1)]);
  await flush();
  // 64 rows retained for one topic: the next one overflows it.
  registry.sink(Array.from({ length: 64 }, (_, index) => row(index + 2)));
  blocked.resolve({ revision: '1', validUntil: 60_000 });
  await registry.settled();
  assert({
    given: 'a running event whose allow arrives after its topic overflowed',
    should: 'resync the subscriber, detach it, and publish nothing',
    actual: {
      types: sent.map((frame) => frame.type),
      attached: [...attached],
      backlog: registry.backlog(0).retained,
    },
    expected: {
      types: ['subscribed', 'resync_required'],
      attached: [],
      backlog: 0,
    },
  });
});

test('one row reaches many recipients concurrently, never more than 32 at once', async () => {
  let held = false;
  let inFlight = 0;
  let peak = 0;
  const gate = deferred<void>();
  const f = fixture({
    authorize: async () => {
      if (held) {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await gate.promise;
        inFlight -= 1;
      }
      return { revision: '1', validUntil: 60_000 };
    },
  });
  await f.registry.subscribe(f.connection, { id: 'r0', topic });
  for (let index = 1; index < 100; index += 1)
    await f.registry.subscribe(
      f.registry.add(f.socket, f.connection.principal),
      { id: `r${index}`, topic },
    );
  held = true;
  f.registry.sink([row(1)]);
  await flush();
  const concurrent = peak;
  gate.resolve();
  await f.registry.settled();
  assert({
    given: '100 subscribers of one topic whose event authorizations all wait',
    should: 'run 32 at once rather than one at a time, then deliver to all',
    actual: {
      concurrent,
      delivered: f.sent.filter((frame) => frame.type === 'event').length,
    },
    expected: { concurrent: 32, delivered: 100 },
  });
});

test('rows nobody here is owed take no delivery capacity', () => {
  const { registry } = fixture();
  registry.sink(Array.from({ length: 2000 }, (_, index) => row(index + 1)));
  assert({
    given: '2,000 rows on a topic with no local subscriber',
    should: 'retain none of them',
    actual: registry.backlog(0).retained,
    expected: 0,
  });
});
