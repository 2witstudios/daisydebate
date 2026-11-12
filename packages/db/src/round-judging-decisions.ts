import { isDeepStrictEqual } from 'node:util';
import { createAppError } from '@daisy/errors';
import type { Ballot, JudgingStage, JudgingStageInput } from '@daisy/protocol';
import type { JudgingScope } from './round-judging-context';
import type { agentRuns } from './schema/agent-runs';
import type {
  roundJudgingAttempts,
  roundJudgingJobs,
} from './schema/round-judging-jobs';

type Job = typeof roundJudgingJobs.$inferSelect;
type Run = typeof agentRuns.$inferSelect;

/** A job is claimable when queued or expired, and unbound or bound to this command. */
export function requireClaimableJob(
  job: Job | undefined,
  commandId: string,
  now: Date,
): asserts job is Job {
  if (
    !job ||
    (job.commandId !== null && job.commandId !== commandId) ||
    !['queued', 'leased', 'recovering'].includes(job.status) ||
    (job.retryAt && job.retryAt.getTime() > now.getTime()) ||
    (job.leaseExpiresAt && job.leaseExpiresAt.getTime() > now.getTime())
  )
    throw createAppError('CONFLICT', 'Judging intent unavailable');
}

/** The scope's service is its own run; a lease never transfers between runs. */
export function requireJudgingService(scope: JudgingScope): void {
  if (scope.serviceId !== `agent-run:${scope.agentRunId}`)
    throw createAppError('AUTHORIZATION');
}

/** The job is still leased to this exact epoch, revision and command. */
export function requireCurrentJob(
  job: Job | undefined,
  scope: JudgingScope,
): asserts job is Job {
  if (
    !job ||
    job.status !== 'leased' ||
    job.attempts !== scope.jobEpoch ||
    job.freezeRevision !== scope.freezeRevision ||
    job.commandId !== scope.commandId
  )
    throw createAppError('CONFLICT', 'Judging lease changed');
}

/** Lease expiry is judged against a clock sampled after the job lock wait. */
export function requireLiveJudgingLease(job: Job, now: Date): void {
  if (!job.leaseExpiresAt || job.leaseExpiresAt.getTime() <= now.getTime())
    throw createAppError('CONFLICT', 'Judging lease expired');
}

/** The run is the live judging run configured for exactly this job. */
export function requireCurrentRun(
  run: Run | undefined,
  scope: JudgingScope,
): asserts run is Run {
  if (!run || run.endedAt !== null || run.kind !== 'judging')
    throw createAppError('AUTHORIZATION');
  const config = run.configurationSnapshot;
  if (
    config.roundId !== scope.roundId ||
    config.judgeParticipantId !== scope.judgeParticipantId ||
    config.freezeRevision !== scope.freezeRevision ||
    config.jobEpoch !== scope.jobEpoch
  )
    throw createAppError('AUTHORIZATION');
}

type Attempt = typeof roundJudgingAttempts.$inferSelect;

/**
 * Where a judging job stands (ADR 0125): a final ballot held for submission,
 * or the one coherency stage its next call buys, with what that call reads.
 */
export type JudgingProgress =
  | { readonly kind: 'ballot_held'; readonly ballot: Ballot }
  | { readonly kind: 'stage_due'; readonly due: JudgingStageInput };

/**
 * The first pass until it is stored or its one try is spent, then the case
 * map, then the final ballot read from that map; nothing once a final ballot
 * is held.
 */
export function judgingProgress(
  job: Pick<
    Job,
    'pendingBallot' | 'firstBallot' | 'firstBallotFailed' | 'caseMap'
  >,
): JudgingProgress {
  if (job.pendingBallot)
    return { kind: 'ballot_held', ballot: job.pendingBallot };
  if (!job.firstBallot && !job.firstBallotFailed)
    return { kind: 'stage_due', due: { stage: 'first' } };
  return {
    kind: 'stage_due',
    due: job.caseMap
      ? { stage: 'final', caseMap: job.caseMap }
      : { stage: 'map' },
  };
}

/** A dispatch buys exactly the stage the job needs, never another. */
export function requireNextStage(
  job: Parameters<typeof judgingProgress>[0],
  stage: JudgingStage,
): void {
  const progress = judgingProgress(job);
  if (progress.kind !== 'stage_due' || progress.due.stage !== stage)
    throw createAppError('CONFLICT', 'Judging stage not due');
}

/**
 * A takeover finds the first pass still dispatched by an earlier run that
 * lost its lease (a deploy or a crash mid-call): that lost call was its one
 * try, so the takeover never buys it again (ADR 0125).
 */
export function firstPassLost(
  job: Pick<Job, 'firstBallot' | 'firstBallotFailed'>,
  priorFirstAttempt: Pick<Attempt, 'outcome'> | undefined,
): boolean {
  return (
    !job.firstBallot &&
    !job.firstBallotFailed &&
    priorFirstAttempt?.outcome === 'dispatched'
  );
}

/** One provider dispatch per run, and none once a response is held. */
export function requireUndispatched(
  job: Pick<Job, 'pendingBallot'>,
  attempt: Pick<Attempt, 'outcome'> | undefined,
): void {
  if (job.pendingBallot || attempt)
    throw createAppError('CONFLICT', 'Model call already dispatched');
}

/**
 * The first accounted response is kept; an identical retry is a no-op and a
 * different response refuses. A response is stored only after its usage.
 */
export function pendingBallotAction(
  job: Pick<Job, 'pendingBallot'>,
  attempt: Pick<Attempt, 'answeredAt'> | undefined,
  ballot: unknown,
): 'store' | 'kept' {
  if (job.pendingBallot) {
    if (!isDeepStrictEqual(job.pendingBallot, ballot))
      throw createAppError('CONFLICT', 'Judging response already recorded');
    return 'kept';
  }
  if (!attempt?.answeredAt)
    throw createAppError('CONFLICT', 'Model response not accounted');
  return 'store';
}
