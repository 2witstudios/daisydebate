import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import type { JudgingTerminalReason } from '@daisy/protocol';
import { startRoundJudgingService } from './service';
import { failureLog, manualTimers } from '../../lib/worker-timers.test-support';
setupRitewayBun();

/** One discoverable judging job with injected renewal, execution and verification. */
function oneJob(input: {
  readonly renew: () => Promise<
    | { readonly kind: 'renewed' }
    | { readonly kind: 'ended'; readonly reason: JudgingTerminalReason }
  >;
  readonly execute: (signal: AbortSignal) => Promise<unknown>;
  readonly pendingBallot: unknown;
  readonly jobEnded?: (reason: JudgingTerminalReason) => void;
}) {
  const { failures, failed } = failureLog();
  const { tasks, timers } = manualTimers();
  let claims = 0;
  const service = startRoundJudgingService({
    reserveCapacity: () => () => {},
    store: {
      scanRoundJudgingJobs: async () => [
        { roundId: 'round', judgeParticipantId: 'judge' },
      ],
      claimRoundJudgingJob: async () => {
        claims++;
        return {
          scope: { roundId: 'round', judgeParticipantId: 'judge' },
          token: 'memory-only',
        };
      },
      renewRoundJudgingJob: input.renew,
      verifyRoundJudgingJob: async () => ({
        pendingBallot: input.pendingBallot,
      }),
    },
    execute: (_claim, signal) => input.execute(signal),
    limits: { parallel: 1, scanBatch: 4, scanMs: 500, renewMs: 3000 },
    timers,
    failed,
    ...(input.jobEnded ? { jobEnded: input.jobEnded } : {}),
  });
  const settle = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve();
  };
  return {
    service,
    failures,
    claims: () => claims,
    scan: async () => {
      await tasks.get(500)!();
      await settle();
    },
    renew: async () => {
      await tasks.get(3000)!();
      await settle();
    },
  };
}

test('a renewal that finds the job ended cancels the call and names the reason', async () => {
  const ended: JudgingTerminalReason[] = [];
  let aborted = false;
  const job = oneJob({
    renew: async () => ({ kind: 'ended', reason: 'generation_deadline' }),
    execute: (signal) =>
      new Promise((resolve) =>
        signal.addEventListener('abort', () => {
          aborted = true;
          resolve(undefined);
        }),
      ),
    pendingBallot: null,
    jobEnded: (reason) => ended.push(reason),
  });
  await job.scan();
  await job.renew();
  assert({
    given: 'a lease renewal answering that the budget ended the job',
    should: 'abort the paid call and report the reason it was given',
    actual: { aborted, ended },
    expected: { aborted: true, ended: ['generation_deadline'] },
  });
  await job.service.stop();
});

test('a renewal that fails for a transient reason keeps the paid call running', async () => {
  const outage = createAppError('INFRASTRUCTURE', 'pool reset');
  let aborted = false;
  const job = oneJob({
    renew: async () => {
      throw outage;
    },
    execute: (signal) =>
      new Promise((resolve) =>
        signal.addEventListener('abort', () => {
          aborted = true;
          resolve(undefined);
        }),
      ),
    pendingBallot: null,
  });
  await job.service.started;
  await job.renew();
  const abortedByRenewal = aborted;
  await job.service.stop();
  assert({
    given: 'a judging renewal refused by a transient database error',
    should:
      'report the renewal and leave the model call running; only a lost lease aborts it (ISSUE-462)',
    actual: { abortedByRenewal, failures: job.failures },
    expected: { abortedByRenewal: false, failures: [[outage, 'renew']] },
  });
});

test('a saved ballot that keeps failing to submit is reported and its slot released', async () => {
  const refusal = createAppError('CONFLICT', 'Ballot refused');
  let executions = 0;
  const job = oneJob({
    renew: async () => ({ kind: 'renewed' }),
    execute: async () => {
      executions++;
      throw refusal;
    },
    pendingBallot: { winner: 'affirmative' },
  });
  await job.service.started;
  for (let i = 0; i < 4; i++) await job.scan();
  await job.service.stop();
  assert({
    given:
      'a saved AI ballot whose submission is refused on every scan (ISSUE-463)',
    should:
      'try it three times in a row, report it once and release the slot for a fresh claim',
    actual: {
      executions,
      failures: job.failures,
      claims: job.claims(),
    },
    expected: {
      executions: 4,
      failures: [[refusal, 'execute']],
      claims: 2,
    },
  });
});

test('a delayed old renewal cannot remove a replacement judging claim', async () => {
  const { tasks, timers } = manualTimers();
  const oldRenewal = Promise.withResolvers<void>();
  const firstExecution = Promise.withResolvers<void>();
  const replacementEntered = Promise.withResolvers<void>();
  const firstReported = Promise.withResolvers<void>();
  const renewed: string[] = [];
  let claims = 0;
  const service = startRoundJudgingService({
    reserveCapacity: () => () => {},
    store: {
      scanRoundJudgingJobs: async () => [
        { roundId: 'replace', judgeParticipantId: 'judge' },
      ],
      claimRoundJudgingJob: async (scope) => ({
        scope,
        token: String(++claims),
      }),
      renewRoundJudgingJob: async (_scope, token) => {
        renewed.push(token);
        if (token === '1') await oldRenewal.promise;
        return { kind: 'renewed' };
      },
      verifyRoundJudgingJob: async () => ({ pendingBallot: null }),
    },
    execute: async (claim, signal) => {
      if (claim.token === '1') return firstExecution.promise;
      replacementEntered.resolve();
      await new Promise<void>((resolve) =>
        signal.addEventListener('abort', () => resolve(), { once: true }),
      );
    },
    limits: { parallel: 1, scanBatch: 4, scanMs: 500, renewMs: 3000 },
    timers,
    failed: () => firstReported.resolve(),
  });
  await service.started;
  const renewing = tasks.get(3000)!();
  firstExecution.reject(createAppError('INFRASTRUCTURE'));
  await firstReported.promise;
  await tasks.get(500)!();
  await replacementEntered.promise;
  oldRenewal.reject(createAppError('CONFLICT'));
  await renewing;
  await tasks.get(3000)!();
  await service.stop();
  assert({
    given: 'a lost old lease renewal after its job was reclaimed locally',
    should: 'renew and retain shutdown tracking for the replacement claim',
    actual: renewed,
    expected: ['1', '2'],
  });
});
