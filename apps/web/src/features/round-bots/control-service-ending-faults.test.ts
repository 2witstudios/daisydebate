import { assert, setupRitewayBun, test } from 'riteway/bun';
import { startBotControlService } from './control-service';
import {
  failureStages,
  neverOverdue,
  ownedClaim,
  seat,
} from './control-service.test-support';
import { failureLog, manualTimers } from '../../lib/worker-timers.test-support';
import { within } from '../../lib/deadline.test-support';
setupRitewayBun();

const limits = { maxControllers: 2, scanBatch: 4, scanMs: 500, renewMs: 3000 };

test('a deadline that cannot be kept reports its own error, revokes the lease, and a later stop failure is still reported (ISSUE-789)', async () => {
  const { failures, failed } = failureLog();
  const revoked: string[] = [];
  const incoming = Promise.withResolvers<void>();
  const stopping = Promise.withResolvers<void>();
  let segment = 'first',
    deadlines = 0;
  const { tasks, timers } = manualTimers();
  const service = startBotControlService({
    store: {
      scanRoundBotWorkers: async () => [seat('seat', segment)],
      claimRoundBotWorker: async (target) => ownedClaim(target),
      revokeRoundBotWorker: async (scope) => {
        revoked.push(scope.segmentId);
      },
      verifyRoundBotWorker: async () => {},
    },
    control: (claim) => ({
      pulse: async () => {
        if (claim.scope.segmentId === 'second') incoming.resolve();
        return [];
      },
      // Still stopping when the deadline fails; it fails afterwards.
      stop: () =>
        claim.scope.segmentId === 'first'
          ? stopping.promise
          : Promise.resolve(),
    }),
    limits,
    timers,
    // Only the outgoing ending's deadline is broken.
    overdue: () => {
      if (deadlines++ === 0) throw new Error('timer unavailable');
      return neverOverdue();
    },
    failed,
  });
  await service.started;
  segment = 'second';
  await tasks.get(500)!();
  await within(incoming.promise, 'The incoming claim');
  stopping.reject(new Error('speaker stop failed'));
  await service.stop();
  assert({
    given:
      'an ending whose deadline throws while its stop is running, and whose stop then fails',
    should:
      'report the deadline error, revoke the outgoing lease, and still report the stop failure',
    actual: { revoked, stages: failureStages(failures) },
    expected: {
      revoked: ['first', 'second'],
      stages: [
        ['timer unavailable', 'stop'],
        ['speaker stop failed', 'stop'],
      ],
    },
  });
});

test('a revoke that throws synchronously is reported once, and the incoming claim still runs (ISSUE-789)', async () => {
  const { failures, failed } = failureLog();
  const incoming = Promise.withResolvers<void>();
  let segment = 'first';
  const { tasks, timers } = manualTimers();
  const service = startBotControlService({
    store: {
      scanRoundBotWorkers: async () => [seat('seat', segment)],
      claimRoundBotWorker: async (target) => ownedClaim(target),
      revokeRoundBotWorker: (scope) => {
        if (scope.segmentId === 'first') throw new Error('pool gone');
        return Promise.resolve();
      },
      verifyRoundBotWorker: async () => {},
    },
    control: (claim) => ({
      pulse: async () => {
        if (claim.scope.segmentId === 'second') incoming.resolve();
        return [];
      },
      stop: async () => {},
    }),
    limits,
    timers,
    overdue: neverOverdue,
    failed,
  });
  await service.started;
  segment = 'second';
  await tasks.get(500)!();
  await within(incoming.promise, 'The incoming claim');
  await service.stop();
  assert({
    given: 'a rotation whose outgoing revoke throws before returning a promise',
    should: 'report it once as revoke and still claim the incoming segment',
    actual: failureStages(failures),
    expected: [['pool gone', 'revoke']],
  });
});
