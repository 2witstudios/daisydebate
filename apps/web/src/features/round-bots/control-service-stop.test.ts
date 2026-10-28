import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { startBotControlService } from './control-service';
import { failureLog, manualTimers } from '../../lib/worker-timers.test-support';
setupRitewayBun();

const ownedClaim = (target: {
  readonly roundId: string;
  readonly roundParticipantId: string;
  readonly segmentId: string;
}) => ({
  scope: {
    ...target,
    agentRunId: 'run',
    serviceId: 'agent-run:run',
    publicationEpoch: 1,
  },
  token: 'memory-only',
});
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
  let segment = 'first';
  const { tasks, timers } = manualTimers();
  const service = startBotControlService({
    store: {
      scanRoundBotWorkers: async () => [
        { roundId: 'round', roundParticipantId: 'seat', segmentId: segment },
      ],
      claimRoundBotWorker: async (target) => {
        log.push(`claim:${target.segmentId}`);
        return ownedClaim(target);
      },
      revokeRoundBotWorker: async (scope) => {
        log.push(`revoke:${scope.segmentId}`);
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
