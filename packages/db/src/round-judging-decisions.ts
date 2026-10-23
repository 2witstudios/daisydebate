import { isDeepStrictEqual } from 'node:util';
import { createAppError } from '@daisy/errors';
import type { JudgingScope } from './round-judging-context';
import type { agentRuns } from './schema/agent-runs';
import type { roundJudgingJobs } from './schema/round-judging-jobs';

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
    !['queued', 'leased'].includes(job.status) ||
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

/** One provider dispatch per attempt, and none once a response is held. */
export function requireUndispatched(
  job: Pick<Job, 'pendingBallot'>,
  run: Pick<Run, 'configurationSnapshot'>,
): void {
  if (
    job.pendingBallot ||
    run.configurationSnapshot.providerOutcome !== 'not_started'
  )
    throw createAppError('CONFLICT', 'Model call already dispatched');
}

/**
 * The first accounted response is kept; an identical retry is a no-op and a
 * different response refuses. A response is stored only after its usage.
 */
export function pendingBallotAction(
  job: Pick<Job, 'pendingBallot'>,
  run: Pick<Run, 'configurationSnapshot'>,
  ballot: unknown,
): 'store' | 'kept' {
  if (job.pendingBallot) {
    if (!isDeepStrictEqual(job.pendingBallot, ballot))
      throw createAppError('CONFLICT', 'Judging response already recorded');
    return 'kept';
  }
  if (run.configurationSnapshot.providerOutcome !== 'received')
    throw createAppError('CONFLICT', 'Model response not accounted');
  return 'store';
}
