import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { startBotControlService } from './control-service';
import {
  neverOverdue,
  ownedClaim,
  within,
} from './control-service.test-support';
import { failureLog, manualTimers } from '../../lib/worker-timers.test-support';
setupRitewayBun();

const seat = (segmentId: string) => ({
  roundId: 'seat',
  roundParticipantId: 'seat',
  segmentId,
});

/**
 * A rotation while the outgoing claim's receipt pulse is in flight, which
 * then rejects with a failure its lease check cannot prove is a refusal.
 */
async function rotateDuringFailingPulse(overrun: boolean) {
  const { failures, failed } = failureLog();
  const fault = createAppError('INFRASTRUCTURE', 'receipt write failed');
  const reject = Promise.withResolvers<void>();
  const due = Promise.withResolvers<void>();
  const incoming = Promise.withResolvers<void>();
  let segment = 'first',
    failing = false,
    deadlines = 0;
  const { tasks, timers } = manualTimers();
  const service = startBotControlService({
    store: {
      scanRoundBotWorkers: async () => [seat(segment)],
      claimRoundBotWorker: async (target) => ownedClaim(target),
      revokeRoundBotWorker: async () => {},
      verifyRoundBotWorker: async () => {
        throw createAppError('INFRASTRUCTURE', 'pool reset');
      },
    },
    control: (claim) => ({
      pulse: async () => {
        if (claim.scope.segmentId === 'second') {
          incoming.resolve();
          return [];
        }
        if (!failing) return [];
        await reject.promise;
        throw fault;
      },
      stop: async () => {},
    }),
    limits: { maxControllers: 1, scanBatch: 4, scanMs: 500, renewMs: 3000 },
    timers,
    overdue: () =>
      overrun && deadlines++ === 0 ? due.promise : neverOverdue(),
    failed,
  });
  await service.started;
  failing = true;
  void tasks.get(3000)!();
  segment = 'second';
  await tasks.get(500)!();
  if (overrun) {
    due.resolve();
    await within(incoming.promise, 'The incoming claim');
    reject.resolve();
  } else {
    reject.resolve();
    await within(incoming.promise, 'The incoming claim');
  }
  await service.stop();
  return failures.map((failure) => [
    ((failure as unknown[])[0] as Error).message,
    (failure as unknown[])[1],
  ]);
}

test('a pulse that fails during an ending that finishes in time is reported (ISSUE-789)', async () => {
  assert({
    given:
      'a rotation whose in-flight receipt pulse rejects before its deadline',
    should: 'report that pulse failure',
    actual: await rotateDuringFailingPulse(false),
    expected: [['receipt write failed', 'pulse']],
  });
});

test('a pulse that fails after its overrun was reported is not reported again (ISSUE-789)', async () => {
  assert({
    given: 'a rotation whose in-flight receipt pulse overran, then rejected',
    should: 'report only the overrun',
    actual: await rotateDuringFailingPulse(true),
    expected: [['Seat pulse overran its ending', 'pulse']],
  });
});
