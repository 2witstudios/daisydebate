import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { startRoundMediaRecovery } from '../src/server/round-media-recovery';
import { createRoundRuntimeOperations } from '../src/features/round-runtime/operations';
import { withMediaRound } from './round-media.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('actual post-start shared engine advancement remains safe for media reconciliation', async () => {
  await withMediaRound(async (f) => {
    await f.mediaOperations.session(f.roundId, f.host.actorId);
    let failures = 0;
    const recovery = startRoundMediaRecovery({
      recover: () => f.mediaOperations.recoverActiveSessions(),
      failed: () => {
        failures++;
      },
      every: (ms, tick) => {
        const timer = setInterval(tick, ms);
        return { stop: () => clearInterval(timer) };
      },
    });
    try {
      await recovery.started;
      const round = (await f.store.getRound(f.roundId))!;
      await createRoundRuntimeOperations({
        store: f.store,
        nextSegmentId: createId,
      }).command({ kind: 'human', actorId: f.host.actorId }, f.roundId, {
        version: 1,
        commandId: createId(),
        expectedVersion: round.version,
        command: { type: 'start' },
      });
      const state = await f.mediaOperations.reconcile(
        f.roundId,
        f.host.actorId,
      );
      assert({
        given: 'ordinary committed start then real provider reconciliation',
        should:
          'hydrate and tick the actual first speech without becoming unsafe',
        actual: [state.state, state.grants.publish],
        expected: ['ready', ['camera', 'microphone']],
      });
      assert({
        given:
          'the actual 500ms production recovery loop racing member reconciliation',
        should: 'complete without a service failure',
        actual: failures,
        expected: 0,
      });
    } finally {
      await recovery.stop();
    }
  });
});
