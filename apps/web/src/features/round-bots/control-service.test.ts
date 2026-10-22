import { assert, setupRitewayBun, test } from 'riteway/bun';
import { startBotControlService } from './control-service';
import { manualTimers } from './worker-timers.test-support';
setupRitewayBun();
test('idle control discovery and receipt pulses have no provider or media prerequisite', async () => {
  const { tasks: timers, timers: worker } = manualTimers();
  let pulses = 0,
    revoked = 0;
  const target = {
    roundId: 'round',
    roundParticipantId: 'seat',
    segmentId: 'segment',
  };
  const claim = {
    scope: {
      ...target,
      agentRunId: 'run',
      serviceId: 'agent-run:run',
      publicationEpoch: 1,
    },
    token: 'memory-only',
    leaseExpiresAt: '2026-10-22T00:00:30Z',
  };
  const service = startBotControlService({
    store: {
      scanRoundBotWorkers: async () => [target],
      claimRoundBotWorker: async () => claim,
      revokeRoundBotWorker: async () => {
        revoked++;
      },
      verifyRoundBotWorker: async () => {},
    },
    control: () => ({
      pulse: async () => {
        pulses++;
        return [];
      },
    }),
    limits: { maxControllers: 1, scanBatch: 4, scanMs: 500, renewMs: 3000 },
    timers: worker,
    failed: () => {
      throw Error('unexpected');
    },
  });
  await service.started;
  await timers.get(3000)!();
  assert({
    given: 'an actual idle controller with no generation/media port',
    should: 'claim once and pulse attendance independently',
    actual: pulses,
    expected: 2,
  });
  await service.stop();
  assert({
    given: 'control lifecycle shutdown',
    should: 'stop both timers and release only its own lease',
    actual: [timers.size, revoked],
    expected: [0, 1],
  });
});
test('a rotated or stopped claim stops its speaking work before revocation', async () => {
  const log: string[] = [];
  let segment = 'first';
  const claimFor = (segmentId: string) => ({
    scope: {
      roundId: 'round',
      roundParticipantId: 'seat',
      segmentId,
      agentRunId: segmentId,
      serviceId: `agent-run:${segmentId}`,
      publicationEpoch: 1,
    },
    token: 'memory-only',
  });
  const tasks: (() => Promise<void>)[] = [];
  const service = startBotControlService({
    store: {
      scanRoundBotWorkers: async () => [
        { roundId: 'round', roundParticipantId: 'seat', segmentId: segment },
      ],
      claimRoundBotWorker: async (target) => claimFor(target.segmentId),
      revokeRoundBotWorker: async (scope) => {
        log.push(`revoke:${scope.segmentId}`);
      },
      verifyRoundBotWorker: async () => {},
    },
    control: (claim) => ({
      pulse: async () => [],
      stop: async () => {
        log.push(`stop:${claim.scope.segmentId}`);
      },
    }),
    limits: { maxControllers: 1, scanBatch: 4, scanMs: 500, renewMs: 3000 },
    timers: {
      setInterval: (task) => tasks.push(task),
      clearInterval: () => {},
    },
    failed: () => {
      throw Error('unexpected');
    },
  });
  await service.started;
  segment = 'second';
  await tasks[0]!();
  await service.stop();
  assert({
    given: 'a claim rotated to a new segment and then shutdown',
    should: 'stop each speaker before revoking its lease',
    actual: log,
    expected: ['stop:first', 'revoke:first', 'stop:second', 'revoke:second'],
  });
});
