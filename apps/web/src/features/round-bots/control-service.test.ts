import { assert, setupRitewayBun, test } from 'riteway/bun';
import { startBotControlService } from './control-service';
setupRitewayBun();
test('idle control discovery and receipt pulses have no provider or media prerequisite', async () => {
  const timers = new Map<number, () => Promise<void>>();
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
    timers: {
      setInterval: (task, ms) => {
        timers.set(ms, task);
        return ms;
      },
      clearInterval: (handle) => {
        timers.delete(handle as number);
      },
    },
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
