import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { startBotControlService } from './control-service';
import { ownedClaim } from './control-service.test-support';
import { failureLog, manualTimers } from '../../lib/worker-timers.test-support';
setupRitewayBun();

const limits = { maxControllers: 2, scanBatch: 4, scanMs: 500, renewMs: 3000 };
const seat = (id: string, segmentId = 's') => ({
  roundId: id,
  roundParticipantId: id,
  segmentId,
});

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
    should: 'keep discovering: the incoming segment and a new seat are claimed',
    actual: claimed,
    expected: ['rotating:first', 'rotating:second', 'joining:s'],
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
    failed,
  });
  await service.started;
  ended = true;
  const pulsing = tasks.get(3000)!();
  segment = 'second';
  await Promise.all([pulsing, tasks.get(500)!()]);
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
