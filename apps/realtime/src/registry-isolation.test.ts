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
