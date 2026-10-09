import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fixture, row, topic } from './registry.test-support';

setupRitewayBun();

test('a drain between resolved boundary and the caller continuation cannot replay', async () => {
  let resolve!: (boundary: { txid: string; seq: bigint }) => void;
  let started!: () => void;
  const began = new Promise<void>((done) => {
    started = done;
  });
  const { registry, connection, sent, attached } = fixture({
    readCatchup: async () => ({ rows: [row(1)], resync: false }),
    readRetentionBoundary: () =>
      new Promise((done) => {
        resolve = done;
        started();
      }),
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
