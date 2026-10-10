import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fixture, row, topic, pendingRead } from './registry.test-support';

setupRitewayBun();

test('a drain between resolved boundary and the caller continuation cannot replay', async () => {
  const { resolve, began, read } = pendingRead<{ txid: string; seq: bigint }>();
  const { registry, connection, sent, attached } = fixture({
    readCatchup: async () => ({ rows: [row(1)], resync: false }),
    readRetentionBoundary: read,
  });
  registry.seed({ txid: '1', seq: 1n });
  const pending = registry.subscribe(connection, {
    id: 'request',
    topic,
    since: '1:1',
  });
  await began;
  resolve({ txid: '0', seq: 0n });
  // The boundary helper resumes first; drainage is then queued before its caller.
  queueMicrotask(() => registry.sink([row(2)]));
  await pending;
  await registry.settled();
  assert({
    given:
      'drainage after the boundary await resolves but before the receiver resumes',
    should:
      'run final generation/cursor guards at the actual replay and attachment edge',
    actual: {
      frames: sent.map((frame) => frame.type),
      attached: [...attached],
    },
    expected: { frames: ['resync_required'], attached: [] },
  });
});

test('a bell between initial allow and no-cursor attachment retires the pending request', async () => {
  let resolve!: (decision: { revision: string; validUntil: number }) => void;
  const { registry, connection, sent, attached } = fixture({
    authorize: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  const pending = registry.subscribe(connection, { id: 'request', topic });
  resolve({ revision: '1', validUntil: 60_000 });
  queueMicrotask(() => queueMicrotask(() => registry.sink([row(1)])));
  await pending;
  await registry.settled();
  assert({
    given:
      'a room bell invalidating the initial allow before its caller attaches',
    should:
      'retire initialization and explicitly request a fresh HTTP snapshot',
    actual: {
      types: sent.map((frame) => frame.type),
      attached: [...attached],
      pending: connection.topics.has(topic),
    },
    expected: { types: ['resync_required'], attached: [], pending: false },
  });
});
