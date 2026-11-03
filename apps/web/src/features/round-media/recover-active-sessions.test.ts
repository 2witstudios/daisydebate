import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createRoundMediaOperations } from './operations';
import type { MediaOperationInput } from './operation-context';
setupRitewayBun();

const rounds = ['a', 'b', 'c', 'd', 'e', 'f'];

/** Every tick lists all Rounds; each pass stays held until the test settles it. */
const held = () => {
  const gate = Promise.withResolvers<void>();
  const started: string[] = [];
  const operations = createRoundMediaOperations({
    store: {
      activeMediaSessions: async () =>
        rounds.map((roundId) => ({
          roundId,
          now: '2026-01-01T00:00:00.000Z',
          lastPassAt: null,
          claimable: true,
        })),
      requestMediaReconcile: async ({ roundId }: { roundId: string }) => {
        started.push(roundId);
        await gate.promise;
        throw Error('settled');
      },
    },
    reporter: { capture: () => undefined },
    nextId: () => 'id',
    recoveryHeartbeatMs: 0,
  } as unknown as MediaOperationInput);
  return { gate, started, operations };
};

test('recovery starts at most one pass per Round, up to the cap, across ticks', async () => {
  const { gate, started, operations } = held();
  const ticks = [
    operations.recoverActiveSessions(),
    operations.recoverActiveSessions(),
    operations.recoverActiveSessions(),
  ];
  await Promise.resolve();
  await Bun.sleep(0);
  assert({
    given: 'three ticks while every pass is still held',
    should: 'start the first four Rounds once each and nothing more',
    actual: started,
    expected: ['a', 'b', 'c', 'd'],
  });
  gate.resolve();
  await Promise.all(ticks);
  await operations.recoverActiveSessions();
  assert({
    given: 'a tick after those passes settled',
    should: 'free their slots for the next passes',
    actual: started.length,
    expected: 8,
  });
});
