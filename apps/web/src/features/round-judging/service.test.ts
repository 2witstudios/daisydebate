import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { createProviderBudget } from '../../server/provider-budget';
import { startRoundJudgingService } from './service';
import {
  failureLog,
  manualTimers,
} from '../round-bots/worker-timers.test-support';
setupRitewayBun();
test('judging renewal and discovery do not wait for a provider operation', async () => {
  const tasks = new Map<number, () => Promise<void>>();
  let renewals = 0,
    scans = 0,
    stopped = false;
  const entered = Promise.withResolvers<void>();
  const finished = Promise.withResolvers<void>();
  const service = startRoundJudgingService({
    reserveCapacity: () => () => {},
    store: {
      scanRoundJudgingJobs: async () => {
        scans++;
        return [{ roundId: 'round', judgeParticipantId: 'judge' }];
      },
      claimRoundJudgingJob: async () => ({
        scope: { roundId: 'round', judgeParticipantId: 'judge' },
        token: 'memory-only',
      }),
      renewRoundJudgingJob: async () => {
        renewals++;
      },
      verifyRoundJudgingJob: async () => ({ pendingBallot: null }),
    },
    execute: async (_claim, signal) => {
      entered.resolve();
      await new Promise<void>((resolve) =>
        signal.addEventListener(
          'abort',
          () => {
            stopped = true;
            resolve();
          },
          { once: true },
        ),
      );
      finished.resolve();
    },
    limits: { parallel: 1, scanBatch: 4, scanMs: 500, renewMs: 3000 },
    timers: {
      setInterval: (task, ms) => {
        tasks.set(ms, task);
        return ms;
      },
      clearInterval: (handle) => {
        tasks.delete(handle as number);
      },
    },
    failed: () => {
      throw Error('unexpected lifecycle failure');
    },
  });
  await service.started;
  await entered.promise;
  await tasks.get(3000)!();
  await tasks.get(500)!();
  assert({
    given: 'a provider operation still pending',
    should:
      'renew its lease and keep discovery independent without a second claim',
    actual: [renewals, scans],
    expected: [1, 2],
  });
  await service.stop();
  await finished.promise;
  assert({
    given: 'shutdown before owned pools close',
    should: 'abort and await work, then remove both timers',
    actual: [stopped, tasks.size],
    expected: [true, 0],
  });
});

test('a failed judging scan reports its stage', async () => {
  const { failures, failed } = failureLog();
  const outage = new Error('scan outage');
  const service = startRoundJudgingService({
    reserveCapacity: () => () => {},
    store: {
      scanRoundJudgingJobs: async () => {
        throw outage;
      },
      claimRoundJudgingJob: async () => {
        throw new Error('no claim expected');
      },
      renewRoundJudgingJob: async () => {},
      verifyRoundJudgingJob: async () => ({ pendingBallot: null }),
    },
    execute: async () => {},
    limits: { parallel: 1, scanBatch: 4, scanMs: 500, renewMs: 3000 },
    timers: { setInterval: () => 1, clearInterval: () => {} },
    failed,
  });
  await service.started;
  await service.stop();
  assert({
    given: 'a judging job scan that throws',
    should: 'report the raw error with the scan stage',
    actual: failures,
    expected: [[outage, 'scan']],
  });
});

test('a judging lease lost at completion releases without a failure', async () => {
  const { failures, failed } = failureLog();
  const { tasks, timers } = manualTimers();
  const finished = Promise.withResolvers<void>();
  const service = startRoundJudgingService({
    reserveCapacity: () => () => {},
    store: {
      scanRoundJudgingJobs: async () => [
        { roundId: 'round', judgeParticipantId: 'judge' },
      ],
      claimRoundJudgingJob: async () => ({
        scope: { roundId: 'round', judgeParticipantId: 'judge' },
        token: 'memory-only',
      }),
      renewRoundJudgingJob: async () => {
        throw createAppError('CONFLICT', 'Judging lease lost');
      },
      verifyRoundJudgingJob: async () => ({ pendingBallot: null }),
    },
    execute: (_claim, signal) =>
      new Promise((resolve) =>
        signal.addEventListener('abort', () => {
          resolve(undefined);
          finished.resolve();
        }),
      ),
    limits: { parallel: 1, scanBatch: 4, scanMs: 500, renewMs: 3000 },
    timers,
    failed,
  });
  await service.started;
  await tasks.get(3000)!();
  await finished.promise;
  await service.stop();
  assert({
    given: 'a renewal refused because the judging job was completed elsewhere',
    should: 'abort the local work and report no worker failure',
    actual: failures,
    expected: [],
  });
});

test('capacity refusal never consumes a judging lease and retry needs no lease expiry', async () => {
  const capacity = createProviderBudget(2);
  const speechDone = Promise.withResolvers<void>();
  const speech = capacity(
    new AbortController().signal,
    () => speechDone.promise,
  );
  const otherJudge = capacity.reserve()!;
  const { tasks, timers } = manualTimers();
  let claims = 0;
  const executed = Promise.withResolvers<void>();
  const service = startRoundJudgingService({
    reserveCapacity: () => capacity.reserve(),
    store: {
      scanRoundJudgingJobs: async () => [
        { roundId: 'waiting', judgeParticipantId: 'seat' },
      ],
      claimRoundJudgingJob: async (scope) => {
        claims++;
        return { scope, token: 'reserved' };
      },
      renewRoundJudgingJob: async () => {},
      verifyRoundJudgingJob: async () => ({ pendingBallot: null }),
    },
    execute: async () => {
      executed.resolve();
    },
    limits: { parallel: 2, scanBatch: 4, scanMs: 500, renewMs: 3000 },
    timers,
    failed: () => {
      throw Error('unexpected capacity failure');
    },
  });
  try {
    await service.started;
    assert({
      given: 'live bot speech and another judge occupy the competitive budget',
      should: 'leave the waiting job unclaimed',
      actual: claims,
      expected: 0,
    });
    otherJudge();
    await tasks.get(500)!();
    await executed.promise;
    assert({
      given: 'one competitive slot freed while bot speech remains held',
      should: 'claim and execute on the next scan without a lease-expiry delay',
      actual: claims,
      expected: 1,
    });
  } finally {
    otherJudge();
    speechDone.resolve();
    await speech;
    await service.stop();
  }
});

test('claim failure and shutdown while claiming return the reserved provider slot', async () => {
  const reclaimed: boolean[] = [];
  for (const mode of ['failure', 'shutdown'] as const) {
    const capacity = createProviderBudget(1);
    const claiming = Promise.withResolvers<void>();
    const claimDone = Promise.withResolvers<{
      scope: { roundId: string; judgeParticipantId: string };
      token: string;
    }>();
    const service = startRoundJudgingService({
      reserveCapacity: () => capacity.reserve(),
      store: {
        scanRoundJudgingJobs: async () => [
          { roundId: mode, judgeParticipantId: 'seat' },
        ],
        claimRoundJudgingJob: () => {
          claiming.resolve();
          return claimDone.promise;
        },
        renewRoundJudgingJob: async () => {},
        verifyRoundJudgingJob: async () => ({ pendingBallot: null }),
      },
      execute: async () => {
        throw Error('claim must not execute');
      },
      limits: { parallel: 1, scanBatch: 1, scanMs: 500, renewMs: 3000 },
      timers: { setInterval: () => 1, clearInterval: () => {} },
      failed: () => {
        throw Error('advisory claim failure should be ignored');
      },
    });
    await claiming.promise;
    const stopping = mode === 'shutdown' ? service.stop() : null;
    if (mode === 'failure') claimDone.reject(createAppError('CONFLICT'));
    else
      claimDone.resolve({
        scope: { roundId: mode, judgeParticipantId: 'seat' },
        token: 'claim',
      });
    await service.started;
    await stopping;
    const release = capacity.reserve();
    reclaimed.push(release !== null);
    release?.();
    await service.stop();
  }
  assert({
    given: 'a failed durable claim or shutdown before its reply',
    should: 'return admission without leaving an occupied provider slot',
    actual: reclaimed,
    expected: [true, true],
  });
});
