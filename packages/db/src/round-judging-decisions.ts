import { isDeepStrictEqual } from 'node:util';
import { createAppError } from '@daisy/errors';
import type { JudgingStage } from '@daisy/protocol';
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
 * The coherency stage a job needs next (ADR 0125): the first pass until it
 * is stored or its one try failed, then the case map, then the final ballot.
 * Null once a final ballot is held: nothing more is bought.
 */
export function nextJudgingStage(
  job: Pick<
    Job,
    'pendingBallot' | 'firstBallot' | 'firstBallotFailed' | 'caseMap'
  >,
): JudgingStage | null {
  if (job.pendingBallot) return null;
  if (!job.firstBallot && !job.firstBallotFailed) return 'first';
  return job.caseMap ? 'final' : 'map';
}

/** A dispatch buys exactly the stage the job needs, never another. */
export function requireNextStage(
  job: Parameters<typeof nextJudgingStage>[0],
  stage: JudgingStage,
): void {
  if (nextJudgingStage(job) !== stage)
    throw createAppError('CONFLICT', 'Judging stage not due');
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
