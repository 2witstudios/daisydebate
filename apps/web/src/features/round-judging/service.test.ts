import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError, createRefusal } from '@daisy/errors';
import { createProviderBudget } from '../../server/provider-budget';
import { startRoundJudgingService } from './service';
import {
  failureLog,
  inertWaits,
  manualWaits,
} from '../../lib/manual-waits.test-support';
setupRitewayBun();
test('judging renewal and discovery do not wait for a provider operation', async () => {
  const { tasks, waits } = manualWaits();
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
        return { kind: 'renewed' };
      },
      verifyRoundJudgingJob: async () => ({
        progress: { kind: 'stage_due' as const },
      }),
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
    limits: {
      parallel: 1,
      scanBatch: 4,
      scanMs: 500,
      renewMs: 3000,
      leaseMs: 30_000,
    },
    waits,
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
    expected: [1, 4],
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
      renewRoundJudgingJob: async () => ({ kind: 'renewed' }),
      verifyRoundJudgingJob: async () => ({
        progress: { kind: 'stage_due' as const },
      }),
    },
    execute: async () => {},
    limits: {
      parallel: 1,
      scanBatch: 4,
      scanMs: 500,
      renewMs: 3000,
      leaseMs: 30_000,
    },
    waits: inertWaits,
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
  const { tasks, waits } = manualWaits();
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
      verifyRoundJudgingJob: async () => ({
        progress: { kind: 'stage_due' as const },
      }),
    },
    execute: (_claim, signal) =>
      new Promise((resolve) =>
        signal.addEventListener('abort', () => {
          resolve(undefined);
          finished.resolve();
        }),
      ),
    limits: {
      parallel: 1,
      scanBatch: 4,
      scanMs: 500,
      renewMs: 3000,
      leaseMs: 30_000,
    },
    waits,
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
  const { tasks, waits } = manualWaits();
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
      renewRoundJudgingJob: async () => ({ kind: 'renewed' }),
      verifyRoundJudgingJob: async () => ({
        progress: { kind: 'stage_due' as const },
      }),
    },
    execute: async () => {
      executed.resolve();
    },
    limits: {
      parallel: 2,
      scanBatch: 4,
      scanMs: 500,
      renewMs: 3000,
      leaseMs: 30_000,
    },
    waits,
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
        renewRoundJudgingJob: async () => ({ kind: 'renewed' }),
        verifyRoundJudgingJob: async () => ({
          progress: { kind: 'stage_due' as const },
        }),
      },
      execute: async () => {
        throw Error('claim must not execute');
      },
      limits: {
        parallel: 1,
        scanBatch: 1,
        scanMs: 500,
        renewMs: 3000,
        leaseMs: 30_000,
      },
      waits: inertWaits,
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

test('a ballot waiting on attendance is no failure, whatever its message says (ISSUE-1010)', async () => {
  const { failures, failed } = failureLog();
  const { waits } = manualWaits();
  const executed = Promise.withResolvers<void>();
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
      renewRoundJudgingJob: async () => ({ kind: 'renewed' }),
      verifyRoundJudgingJob: async () => ({
        progress: { kind: 'stage_due' as const },
      }),
    },
    execute: async () => {
      executed.resolve();
      throw createRefusal(
        'CONFLICT',
        'attendance-unsettled',
        'Any reworded sentence',
      );
    },
    limits: {
      parallel: 1,
      scanBatch: 4,
      scanMs: 500,
      renewMs: 3000,
      leaseMs: 30_000,
    },
    waits,
    failed,
  });
  await service.started;
  await executed.promise;
  await service.stop();
  assert({
    given: 'a judging run refused only because attendance is unsettled',
    should: 'report no worker failure',
    actual: failures,
    expected: [],
  });
});

test('one refused judging kind is reported and scanning keeps its pace', async () => {
  const { failures, failed } = failureLog();
  const outage = new Error('submission scan outage');
  const { waits, armed, nextPass } = manualWaits();
  const service = startRoundJudgingService({
    reserveCapacity: () => () => {},
    store: {
      scanRoundJudgingJobs: async (_limit, kind) => {
        if (kind === 'submission') throw outage;
        return [{ roundId: 'round', judgeParticipantId: 'judge' }];
      },
      claimRoundJudgingJob: async () => ({
        scope: { roundId: 'round', judgeParticipantId: 'judge' },
        token: 'memory-only',
      }),
      renewRoundJudgingJob: async () => ({ kind: 'renewed' }),
      verifyRoundJudgingJob: async () => ({
        progress: { kind: 'stage_due' as const },
      }),
    },
    execute: () => new Promise(() => {}),
    limits: {
      parallel: 1,
      scanBatch: 4,
      scanMs: 500,
      renewMs: 3000,
      leaseMs: 30_000,
    },
    waits,
    failed,
  });
  await service.started;
  // The scan's wait, not the held job's lease renewal (3 s) or its horizon.
  const scanPace = (ms: number) => ms < 3000;
  await nextPass(scanPace);
  assert({
    given: 'the submission scan refused while generation work is held',
    should: 'report each refusal at the scan stage and keep the busy pace',
    actual: {
      stages: failures.map((entry) => (entry as [unknown, string])[1]),
      armed: armed.filter(scanPace),
    },
    expected: { stages: ['scan', 'scan'], armed: [500, 500] },
  });
  void service.stop();
});
