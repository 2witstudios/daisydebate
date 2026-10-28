import { assert, setupRitewayBun, test } from 'riteway/bun';
import { startBotControlService } from './control-service';
import {
  neverOverdue,
  ownedClaim,
  seat,
  within,
} from './control-service.test-support';
import { failureLog, manualTimers } from '../../lib/worker-timers.test-support';
setupRitewayBun();

/**
 * A rotation whose incoming claim waits on `answer`, then a scan for
 * another seat while it waits, under a cap of `maxControllers`.
 */
async function scanDuringHandoff(maxControllers: number) {
  const { failed } = failureLog();
  const claimed: string[] = [];
  const claiming = Promise.withResolvers<void>();
  const answer = Promise.withResolvers<void>();
  let targets = [seat('rotating', 'first')];
  const { tasks, timers } = manualTimers();
  const service = startBotControlService({
    store: {
      scanRoundBotWorkers: async () => targets,
      claimRoundBotWorker: async (target) => {
        if (target.segmentId === 'second') {
          claiming.resolve();
          await answer.promise;
        }
        claimed.push(`${target.roundParticipantId}:${target.segmentId}`);
        return ownedClaim(target);
      },
      revokeRoundBotWorker: async () => {},
      verifyRoundBotWorker: async () => {},
    },
    control: () => ({ pulse: async () => [], stop: async () => {} }),
    limits: { maxControllers, scanBatch: 4, scanMs: 500, renewMs: 3000 },
    timers,
    overdue: neverOverdue,
    failed,
  });
  await service.started;
  targets = [seat('rotating', 'second')];
  await tasks.get(500)!();
  await within(claiming.promise, 'The incoming claim');
  targets = [seat('rotating', 'second'), seat('joining')];
  await tasks.get(500)!();
  answer.resolve();
  await service.stop();
  return claimed;
}

test('a rotating seat holds one slot while its incoming claim is in flight (ISSUE-789)', async () => {
  assert({
    given: 'a cap of two, one seat rotating and its incoming claim in flight',
    should: 'still admit another seat: the rotating seat counts once',
    actual: (await scanDuringHandoff(2)).sort(),
    expected: ['joining:s', 'rotating:first', 'rotating:second'],
  });
  assert({
    given: 'a cap of one, the rotating seat’s incoming claim in flight',
    should: 'admit no other seat while that claim holds the slot',
    actual: await scanDuringHandoff(1),
    expected: ['rotating:first', 'rotating:second'],
  });
});
