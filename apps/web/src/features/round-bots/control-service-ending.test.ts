import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { startBotControlService } from './control-service';
import { neverOverdue, ownedClaim, seat } from './control-service.test-support';
import { failureLog, manualTimers } from '../../lib/worker-timers.test-support';
import { within } from '../../lib/deadline.test-support';
setupRitewayBun();

const limits = { maxControllers: 2, scanBatch: 4, scanMs: 500, renewMs: 3000 };

test('a rotation whose stop never settles never holds discovery of other seats (ISSUE-789)', async () => {
  const { failed } = failureLog();
  const claimed: string[] = [];
  const stopping = Promise.withResolvers<void>();
  let targets = [seat('rotating', 'first')];
  const { tasks, timers } = manualTimers();
  const service = startBotControlService({
    store: {
      scanRoundBotWorkers: async () => targets,
      claimRoundBotWorker: async (target) => {
        claimed.push(`${target.roundParticipantId}:${target.segmentId}`);
        return ownedClaim(target);
      },
      revokeRoundBotWorker: async () => {},
      verifyRoundBotWorker: async () => {},
    },
    control: () => ({
      pulse: async () => [],
      // A native close that never answers.
      stop: () => {
        stopping.resolve();
        return new Promise<void>(() => {});
      },
    }),
    limits,
    timers,
    overdue: neverOverdue,
    failed,
  });
  await service.started;
  targets = [seat('rotating', 'second')];
  await tasks.get(500)!();
  await stopping.promise;
  targets = [seat('rotating', 'second'), seat('joining')];
  await tasks.get(500)!();
  assert({
    given: 'a rotated claim whose speaking work never stops',
    should:
      'keep discovering other seats, and hold the stopping seat so no second speaker is claimed beside it',
    actual: claimed,
    expected: ['rotating:first', 'joining:s'],
  });
});

test('shutdown waits for a released seat’s stop to finish (ISSUE-789)', async () => {
  const { failed } = failureLog();
  const stopping = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  const order: string[] = [];
  let ended = false;
  const { tasks, timers } = manualTimers();
  const service = startBotControlService({
    store: {
      scanRoundBotWorkers: async () => [seat('ending')],
      claimRoundBotWorker: async (target) => ownedClaim(target),
      revokeRoundBotWorker: async () => {},
      verifyRoundBotWorker: async () => {
        if (ended) throw createAppError('CONFLICT', 'Worker lease expired');
      },
    },
    control: () => ({
      pulse: async () => {
        if (ended)
          throw createAppError('CONFLICT', 'Round is no longer active');
        return [];
      },
      stop: async () => {
        stopping.resolve();
        await finish.promise;
        order.push('stopped');
      },
    }),
    limits,
    timers,
    overdue: neverOverdue,
    failed,
  });
  await service.started;
  ended = true;
  await tasks.get(3000)!();
  await stopping.promise;
  const shutdown = service.stop().then(() => order.push('shutdown'));
  finish.resolve();
  await shutdown;
  assert({
    given: 'a seat released by its pulse whose stop is still running',
    should: 'resolve shutdown only after that stop finished',
    actual: order,
    expected: ['stopped', 'shutdown'],
  });
});

test('a seat its own pulse already released is not stopped or revoked again by a rotation (ISSUE-789)', async () => {
  const incoming = Promise.withResolvers<void>();
  const { failures, failed } = failureLog();
  const log: string[] = [];
  let segment = 'first',
    ended = false;
  const { tasks, timers } = manualTimers();
  const service = startBotControlService({
    store: {
      scanRoundBotWorkers: async () => [seat('seat', segment)],
      claimRoundBotWorker: async (target) => ownedClaim(target),
      revokeRoundBotWorker: async (scope) => {
        log.push(`revoke:${scope.segmentId}`);
      },
      verifyRoundBotWorker: async (scope) => {
        if (ended && scope.segmentId === 'first')
          throw createAppError('CONFLICT', 'Worker claim rotated');
      },
    },
    control: (claim) => ({
      pulse: async () => {
        if (claim.scope.segmentId === 'second') incoming.resolve();
        if (ended && claim.scope.segmentId === 'first')
          throw createAppError('CONFLICT', 'Worker claim rotated');
        return [];
      },
      stop: async () => {
        log.push(`stop:${claim.scope.segmentId}`);
      },
    }),
    limits,
    timers,
    overdue: neverOverdue,
    failed,
  });
  await service.started;
  ended = true;
  const pulsing = tasks.get(3000)!();
  segment = 'second';
  await Promise.all([
    pulsing,
    tasks.get(500)!(),
    within(incoming.promise, 'The incoming claim'),
  ]);
  await service.stop();
  assert({
    given: 'a pulse that loses its authority while the seat rotates',
    should:
      'stop the outgoing claim once and revoke only the claim it still owns',
    actual: { log, failures },
    expected: {
      log: ['stop:first', 'stop:second', 'revoke:second'],
      failures: [],
    },
  });
});

test('a rotation stops its speaker at once, even while a receipt pulse hangs, and reports a failed revoke (ISSUE-789)', async () => {
  const incoming = Promise.withResolvers<void>();
  const { failures, failed } = failureLog();
  const log: string[] = [];
  const revokeFault = new Error('pool outage');
  const hung = Promise.withResolvers<void>();
  let segment = 'first',
    hang = false;
  const { tasks, timers } = manualTimers();
  const service = startBotControlService({
    store: {
      scanRoundBotWorkers: async () => [seat('seat', segment)],
      claimRoundBotWorker: async (target) => ownedClaim(target),
      revokeRoundBotWorker: async (scope) => {
        log.push(`revoke:${scope.segmentId}`);
        if (scope.segmentId === 'first') throw revokeFault;
      },
      verifyRoundBotWorker: async () => {},
    },
    control: (claim) => ({
      pulse: async () => {
        if (claim.scope.segmentId === 'second') incoming.resolve();
        if (hang) await hung.promise;
        return [];
      },
      stop: async () => {
        log.push(`stop:${claim.scope.segmentId}`);
      },
    }),
    limits,
    timers,
    overdue: neverOverdue,
    failed,
  });
  await service.started;
  hang = true;
  void tasks.get(3000)!();
  segment = 'second';
  await tasks.get(500)!();
  const stoppedWhileHung = [...log];
  hung.resolve();
  // The revoke settles before the incoming claim follows the ending.
  await within(incoming.promise, 'The incoming claim');
  assert({
    given:
      'a rotation while the outgoing claim’s receipt pulse hangs, then a revoke the pool refuses',
    should:
      'stop the speaker before the pulse settles, revoke after it, and report the refused revoke',
    actual: { stoppedWhileHung, log, failures },
    expected: {
      stoppedWhileHung: ['stop:first'],
      log: ['stop:first', 'revoke:first'],
      failures: [[revokeFault, 'revoke']],
    },
  });
  await service.stop();
});
