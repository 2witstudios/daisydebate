import { assert, setupRitewayBun, test } from 'riteway/bun';
import { startRoundJudgingService } from './service';
import { manualTimers } from '../../lib/worker-timers.test-support';

setupRitewayBun();
test('a held reply beyond a full paid-work page remains discoverable without provider capacity', async () => {
  const older = Array.from({ length: 65 }, (_, i) => ({
    roundId: `paid-${i}`,
    judgeParticipantId: `j-${i}`,
    holdsBallot: false,
  }));
  const cached = {
    roundId: 'late-cache',
    judgeParticipantId: 'cached',
    holdsBallot: true,
  };
  const { timers, tasks } = manualTimers();
  const claims: string[] = [];
  let available = false;
  const service = startRoundJudgingService({
    reserveCapacity: () => (available ? () => {} : null),
    store: {
      scanRoundJudgingJobs: async (limit: number, kind: string) =>
        (kind === 'submission' ? [cached] : older).slice(0, limit),
      claimRoundJudgingJob: async (scope) => {
        claims.push(scope.roundId);
        return { scope, token: 'memory-only' };
      },
      renewRoundJudgingJob: async () => ({ kind: 'renewed' }),
      verifyRoundJudgingJob: async () => ({ pendingBallot: {} }),
    },
    execute: async (claim, signal) => {
      if (claim.scope.roundId === 'late-cache' && !signal.aborted)
        await new Promise<void>((done) =>
          signal.addEventListener('abort', () => done(), { once: true }),
        );
    },
    limits: { parallel: 1, scanBatch: 64, scanMs: 500, renewMs: 3000 },
    timers,
    failed: () => {},
  });
  try {
    await service.started;
    await tasks.get(500)!();
    assert({
      given:
        '65 older uncached Rounds and a later held reply while paid capacity stays unavailable across scans',
      should: 'reach the held submission without claiming any paid work',
      actual: {
        cache: claims.includes('late-cache'),
        paid: claims.filter((id) => id.startsWith('paid-')).length,
      },
      expected: { cache: true, paid: 0 },
    });
    available = true;
    await tasks.get(500)!();
    assert({
      given: 'provider capacity returning while cached work remains due',
      should: 'also admit paid work through its own bounded lane',
      actual: claims.some((id) => id.startsWith('paid-')),
      expected: true,
    });
  } finally {
    await service.stop();
  }
});
test('provider saturation cannot hide a later validated reply', async () => {
  const claimed: string[] = [],
    submitted: string[] = [];
  const { timers } = manualTimers();
  const service = startRoundJudgingService({
    reserveCapacity: () => null,
    store: {
      scanRoundJudgingJobs: async () => [
        { roundId: 'uncached', judgeParticipantId: 'one', holdsBallot: false },
        { roundId: 'cached', judgeParticipantId: 'two', holdsBallot: true },
      ],
      claimRoundJudgingJob: async (scope) => {
        claimed.push(scope.roundId);
        return { scope, token: 'memory-only' };
      },
      renewRoundJudgingJob: async () => ({ kind: 'renewed' }),
      verifyRoundJudgingJob: async () => ({ pendingBallot: {} }),
    },
    execute: async (claim) => {
      submitted.push(claim.scope.roundId);
    },
    limits: { parallel: 1, scanBatch: 8, scanMs: 500, renewMs: 3000 },
    timers,
    failed: () => {},
  });
  try {
    await service.started;
    assert({
      given:
        'uncached A before held B while every paid provider slot is unavailable',
      should:
        'claim and dispatch only the cached submission operation without buying a call',
      actual: { claimed, submitted },
      expected: { claimed: ['cached'], submitted: ['cached'] },
    });
  } finally {
    await service.stop();
  }
});
test('a Round with several due judges cannot consume every provider slot', async () => {
  const claimed: string[] = [];
  const { timers } = manualTimers();
  const service = startRoundJudgingService({
    reserveCapacity: () => () => {},
    store: {
      scanRoundJudgingJobs: async () => [
        { roundId: 'first', judgeParticipantId: 'one' },
        { roundId: 'first', judgeParticipantId: 'two' },
        { roundId: 'second', judgeParticipantId: 'three' },
      ],
      claimRoundJudgingJob: async (scope) => {
        claimed.push(scope.roundId);
        return { scope, token: 'memory-only' };
      },
      renewRoundJudgingJob: async () => ({ kind: 'renewed' }),
      verifyRoundJudgingJob: async () => ({ pendingBallot: null }),
    },
    execute: async (_claim, signal) => {
      if (signal.aborted) return;
      await new Promise<void>((done) =>
        signal.addEventListener('abort', () => done(), { once: true }),
      );
    },
    limits: { parallel: 2, scanBatch: 8, scanMs: 500, renewMs: 3000 },
    timers,
    failed: () => {},
  });
  try {
    await service.started;
    assert({
      given: 'two due judge seats in one Round ahead of a different Round',
      should:
        'admit at most one running operation per Round and serve both Rounds',
      actual: claimed,
      expected: ['first', 'second'],
    });
  } finally {
    await service.stop();
  }
});
