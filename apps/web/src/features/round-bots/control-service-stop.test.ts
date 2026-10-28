import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { startBotControlService } from './control-service';
import { ownedClaim } from './control-service.test-support';
import { failureLog, manualTimers } from '../../lib/worker-timers.test-support';
setupRitewayBun();

test('a seat whose stop fails at completion never halts the other seats’ heartbeat (ISSUE-789)', async () => {
  const { failures, failed } = failureLog();
  const pulses: string[] = [];
  const stopFault = new Error('The operation was aborted.');
  const targets = ['ended', 'live'].map((seat) => ({
    roundId: seat,
    roundParticipantId: seat,
    segmentId: 's',
  }));
  const { tasks, timers } = manualTimers();
  const service = startBotControlService({
    store: {
      scanRoundBotWorkers: async () => targets,
      claimRoundBotWorker: async (target) => ownedClaim(target),
      revokeRoundBotWorker: async () => {},
      verifyRoundBotWorker: async (scope) => {
        if (scope.roundParticipantId === 'ended')
          throw createAppError('CONFLICT', 'Worker lease expired');
      },
    },
    control: (claim) => ({
      pulse: async () => {
        const seat = claim.scope.roundParticipantId;
        pulses.push(seat);
        if (seat === 'ended' && pulses.length > 2)
          throw createAppError('CONFLICT', 'Round is no longer active');
        return [];
      },
      stop: async () => {
        if (claim.scope.roundParticipantId === 'ended') throw stopFault;
      },
    }),
    limits: { maxControllers: 2, scanBatch: 4, scanMs: 500, renewMs: 3000 },
    timers,
    failed,
  });
  await service.started;
  await tasks.get(3000)!();
  await tasks.get(3000)!();
  await service.stop();
  assert({
    given:
      'a Round that ends while its seat’s native publication fails to close',
    should:
      'report the stop and keep renewing the live seat on every later heartbeat',
    actual: { pulses, failures },
    expected: {
      pulses: ['ended', 'live', 'ended', 'live', 'live'],
      failures: [[stopFault, 'stop']],
    },
  });
});

test('a rotated claim whose stop fails is still revoked and its next segment claimed (ISSUE-789)', async () => {
  const { failures, failed } = failureLog();
  const log: string[] = [];
  const stopFault = new Error('The operation was aborted.');
  const revokedFirst = Promise.withResolvers<void>();
  let segment = 'first',
    leased = false;
  const { tasks, timers } = manualTimers();
  const service = startBotControlService({
    store: {
      scanRoundBotWorkers: async () => [
        { roundId: 'round', roundParticipantId: 'seat', segmentId: segment },
      ],
      // The seat's one claim row refuses a new claim while a lease is live.
      claimRoundBotWorker: async (target) => {
        if (leased)
          throw createAppError('CONFLICT', 'Publication already claimed');
        leased = true;
        log.push(`claim:${target.segmentId}`);
        return ownedClaim(target);
      },
      revokeRoundBotWorker: async (scope) => {
        leased = false;
        log.push(`revoke:${scope.segmentId}`);
        if (scope.segmentId === 'first') revokedFirst.resolve();
      },
      verifyRoundBotWorker: async () => {},
    },
    control: (claim) => ({
      pulse: async () => [],
      stop: async () => {
        if (claim.scope.segmentId === 'first') throw stopFault;
      },
    }),
    limits: { maxControllers: 1, scanBatch: 4, scanMs: 500, renewMs: 3000 },
    timers,
    failed,
  });
  await service.started;
  segment = 'second';
  await tasks.get(500)!();
  await revokedFirst.promise;
  await tasks.get(500)!();
  await service.stop();
  assert({
    given: 'a segment rotation whose old publication fails to close',
    should: 'report the stop, revoke the old lease and claim the new segment',
    actual: { log, failures },
    expected: {
      log: ['claim:first', 'revoke:first', 'claim:second', 'revoke:second'],
      failures: [[stopFault, 'stop']],
    },
  });
});

test('a seat whose stop never settles never holds another seat’s renewal (ISSUE-789)', async () => {
  const { failed } = failureLog();
  const pulses: string[] = [];
  const stopping = Promise.withResolvers<void>();
  let ended = false;
  const targets = ['ending', 'live'].map((seat) => ({
    roundId: seat,
    roundParticipantId: seat,
    segmentId: 's',
  }));
  const { tasks, timers } = manualTimers();
  const service = startBotControlService({
    store: {
      scanRoundBotWorkers: async () => targets,
      claimRoundBotWorker: async (target) => ownedClaim(target),
      revokeRoundBotWorker: async () => {},
      verifyRoundBotWorker: async (scope) => {
        if (ended && scope.roundParticipantId === 'ending')
          throw createAppError('CONFLICT', 'Worker lease expired');
      },
    },
    control: (claim) => ({
      pulse: async () => {
        const seat = claim.scope.roundParticipantId;
        pulses.push(seat);
        if (ended && seat === 'ending')
          throw createAppError('CONFLICT', 'Round is no longer active');
        return [];
      },
      // A native close that never answers.
      stop: () => {
        stopping.resolve();
        return new Promise<void>(() => {});
      },
    }),
    limits: { maxControllers: 2, scanBatch: 4, scanMs: 500, renewMs: 3000 },
    timers,
    failed,
  });
  await service.started;
  ended = true;
  void tasks.get(3000)!();
  await stopping.promise;
  await tasks.get(3000)!();
  await tasks.get(3000)!();
  assert({
    given: 'a Round that ends while its seat’s stop hangs',
    should: 'keep renewing the live seat on every later heartbeat',
    actual: pulses,
    expected: ['ending', 'live', 'ending', 'live', 'live', 'live'],
  });
});

test('a heartbeat during a rotation never pulses the outgoing claim or drops the incoming one (ISSUE-789)', async () => {
  const { failed } = failureLog();
  const pulses: string[] = [];
  const revoked = new Set<string>();
  const stopping = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let segment = 'first';
  const { tasks, timers } = manualTimers();
  const service = startBotControlService({
    store: {
      scanRoundBotWorkers: async () => [
        { roundId: 'round', roundParticipantId: 'seat', segmentId: segment },
      ],
      claimRoundBotWorker: async (target) => ownedClaim(target),
      revokeRoundBotWorker: async (scope) => {
        revoked.add(scope.segmentId);
      },
      verifyRoundBotWorker: async (scope) => {
        if (revoked.has(scope.segmentId))
          throw createAppError('CONFLICT', 'Worker claim rotated');
      },
    },
    control: (claim) => ({
      pulse: async () => {
        pulses.push(claim.scope.segmentId);
        if (revoked.has(claim.scope.segmentId))
          throw createAppError('CONFLICT', 'Worker claim rotated');
        return [];
      },
      stop: async () => {
        if (claim.scope.segmentId !== 'first') return;
        stopping.resolve();
        await release.promise;
      },
    }),
    limits: { maxControllers: 1, scanBatch: 4, scanMs: 500, renewMs: 3000 },
    timers,
    failed,
  });
  await service.started;
  segment = 'second';
  const rotation = tasks.get(500)!();
  await stopping.promise;
  const during = tasks.get(3000)!();
  release.resolve();
  await Promise.all([rotation, during]);
  await tasks.get(3000)!();
  await service.stop();
  assert({
    given: 'a heartbeat that fires while the outgoing claim is still stopping',
    should: 'pulse only the incoming claim, now and on the next heartbeat',
    actual: pulses,
    expected: ['first', 'second', 'second'],
  });
});
