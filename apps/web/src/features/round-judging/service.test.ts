import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { startRoundJudgingService } from './service';
import { manualTimers } from '../round-bots/worker-timers.test-support';
setupRitewayBun();
test('judging renewal and discovery do not wait for a provider operation', async () => {
  const tasks = new Map<number, () => Promise<void>>();
  let renewals = 0,
    scans = 0,
    stopped = false;
  const entered = Promise.withResolvers<void>();
  const finished = Promise.withResolvers<void>();
  const service = startRoundJudgingService({
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
  const failures: unknown[] = [];
  const outage = new Error('scan outage');
  const service = startRoundJudgingService({
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
    failed: (error, stage) => {
      failures.push([error, stage]);
    },
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
  const failures: unknown[] = [];
  const { tasks, timers } = manualTimers();
  const finished = Promise.withResolvers<void>();
  const service = startRoundJudgingService({
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
    failed: (error, stage) => {
      failures.push([error, stage]);
    },
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
