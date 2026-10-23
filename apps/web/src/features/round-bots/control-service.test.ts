import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { refuseCapacity } from '@daisy/db/testing';
import { startBotControlService } from './control-service';
import { failureLog, manualTimers } from './worker-timers.test-support';
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
  leaseExpiresAt: '2026-10-22T00:00:30Z',
});
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

test('failed control discovery and receipt pulses report their stages', async () => {
  const { failures, failed } = failureLog();
  const target = {
    roundId: 'round',
    roundParticipantId: 'seat',
    segmentId: 's',
  };
  const pulseFault = new Error('pulse outage');
  const scanFault = new Error('scan outage');
  let scans = 0;
  const { tasks, timers } = manualTimers();
  const service = startBotControlService({
    store: {
      scanRoundBotWorkers: async () => {
        scans++;
        if (scans > 1) throw scanFault;
        return [target];
      },
      claimRoundBotWorker: async () => ownedClaim(target),
      revokeRoundBotWorker: async () => {},
      verifyRoundBotWorker: async () => {},
    },
    control: () => ({
      pulse: async () => {
        throw pulseFault;
      },
    }),
    limits: { maxControllers: 1, scanBatch: 4, scanMs: 500, renewMs: 3000 },
    timers,
    failed,
  });
  await service.started;
  await tasks.get(500)!();
  await service.stop();
  assert({
    given: 'a receipt pulse that throws, then a scan that throws',
    should: 'report each raw error with its stage',
    actual: failures,
    expected: [
      [pulseFault, 'pulse'],
      [scanFault, 'discover'],
    ],
  });
});

/** One owned seat whose pulse fails, then the service stops. */
async function failedPulse(input: {
  readonly verify: () => Promise<void>;
  readonly pulse: Error;
}) {
  const { failures, failed } = failureLog();
  const stopped: string[] = [];
  const revoked: string[] = [];
  const target = {
    roundId: 'round',
    roundParticipantId: 'seat',
    segmentId: 's',
  };
  const { timers } = manualTimers();
  const service = startBotControlService({
    store: {
      scanRoundBotWorkers: async () => [target],
      claimRoundBotWorker: async () => ownedClaim(target),
      revokeRoundBotWorker: async () => {
        revoked.push('seat');
      },
      verifyRoundBotWorker: input.verify,
    },
    control: () => ({
      pulse: async () => {
        throw input.pulse;
      },
      stop: async () => {
        stopped.push('seat');
      },
    }),
    limits: { maxControllers: 1, scanBatch: 4, scanMs: 500, renewMs: 3000 },
    timers,
    failed,
  });
  await service.started;
  await service.stop();
  return {
    stages: failures.map((failure) => (failure as unknown[])[1]),
    stopped,
    revoked,
  };
}

test('a control lease lost at completion stops its seat without a failure', async () => {
  const { stages, stopped } = await failedPulse({
    verify: async () => {
      throw createAppError('CONFLICT', 'Worker lease expired');
    },
    pulse: createAppError('CONFLICT', 'Round is no longer active'),
  });
  assert({
    given: 'a refused pulse whose claim no longer verifies',
    should: 'stop the seat once and report no worker failure',
    actual: { stages, stopped },
    expected: { stages: [], stopped: ['seat'] },
  });
});

test('a lease check refused by the pool keeps the seat and reports the pulse failure', async () => {
  const { stages, revoked } = await failedPulse({
    verify: async () => {
      throw refuseCapacity();
    },
    pulse: createAppError('INFRASTRUCTURE', 'receipt write failed'),
  });
  assert({
    given: 'a failed pulse whose lease check the shared pool refused',
    should:
      'keep the seat it still owns, report the pulse and revoke the lease only at shutdown (ISSUE-456)',
    actual: { stages, revoked },
    expected: { stages: ['pulse'], revoked: ['seat'] },
  });
});
