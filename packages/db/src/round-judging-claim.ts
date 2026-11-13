import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { judgingPolicy } from '@daisy/protocol';
import type { BoundedTransactionContext } from './transaction-context';
import { agentRuns } from './schema/agent-runs';
import {
  roundJudgingAttempts,
  roundJudgingJobs,
} from './schema/round-judging-jobs';
import { readLockedFrozenRoundTranscript } from './frozen-transcript';
import { agentLeaseDigest } from './round-agent-lease';
import {
  endLockedRoundAgentRun,
  lockRoundAgentContext,
  startLockedRoundAgentRun,
} from './round-agent-runs';
import { readDatabaseTime } from './database-clock';
import { judgingJobWhere, type JudgingScope } from './round-judging-context';
import { nextEpoch } from './lease-policy';
import { firstPassLost, requireClaimableJob } from './round-judging-decisions';

export async function claimLockedJudgingJob(
  tx: BoundedTransactionContext,
  target: Pick<JudgingScope, 'roundId' | 'judgeParticipantId'>,
  input: {
    nextId: () => string;
    nextToken: () => string;
    leaseMs: number;
    model: string;
  },
) {
  const [initial] = await tx
    .select()
    .from(roundJudgingJobs)
    .where(judgingJobWhere(target));
  if (!initial) throw createAppError('NOT_FOUND');
  const commandId = initial.commandId ?? input.nextId();
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${commandId},59002))`,
  );
  const { round, seat } = await lockRoundAgentContext(
    tx,
    target.roundId,
    target.judgeParticipantId,
  );
  if (round.status !== 'active' || seat.role !== 'judge')
    throw createAppError('AUTHORIZATION');
  const priorRuns = await tx
    .select()
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.roundParticipantId, seat.id),
        eq(agentRuns.kind, 'judging'),
        isNull(agentRuns.endedAt),
      ),
    )
    .orderBy(asc(agentRuns.id))
    .for('update');
  const [job] = await tx
    .select()
    .from(roundJudgingJobs)
    .where(judgingJobWhere(target))
    .for('update');
  const now = await readDatabaseTime(tx);
  requireClaimableJob(job, commandId, now);
  const [other] = await tx
    .select({ id: roundJudgingJobs.judgeParticipantId })
    .from(roundJudgingJobs)
    .where(
      and(
        eq(roundJudgingJobs.roundId, target.roundId),
        sql`${roundJudgingJobs.judgeParticipantId}<>${target.judgeParticipantId}`,
        eq(roundJudgingJobs.status, 'leased'),
        sql`${roundJudgingJobs.leaseExpiresAt}>${now}`,
      ),
    )
    .limit(1);
  if (other)
    throw createAppError('CONFLICT', 'Round already has active judging work');
  const frozen = await readLockedFrozenRoundTranscript(tx, round.id);
  if (!frozen || frozen.revision !== job.freezeRevision)
    throw createAppError('CONFLICT', 'Frozen judging input changed');
  const epoch = nextEpoch(job.attempts, 'Judging epoch exhausted');
  for (const prior of priorRuns)
    await endLockedRoundAgentRun(tx, prior.id, seat.id);
  // The first claim pins the model; a deploy cannot change it for a later attempt.
  const model = job.model ?? input.model;
  const agentRunId = input.nextId(),
    token = input.nextToken();
  const scope: JudgingScope = {
    ...target,
    commandId,
    agentRunId,
    serviceId: `agent-run:${agentRunId}`,
    freezeRevision: frozen.revision,
    jobEpoch: epoch,
  };
  await startLockedRoundAgentRun(tx, {
    id: agentRunId,
    participantId: seat.id,
    kind: 'judging',
    model,
    configuration: {
      ...scope,
      executionTokenDigest: agentLeaseDigest(token),
    },
  });
  // Every attempt here is a prior run's: one still dispatched lost its answer.
  const [priorFirstAttempt] = await tx
    .select({ outcome: roundJudgingAttempts.outcome })
    .from(roundJudgingAttempts)
    .where(
      and(
        eq(roundJudgingAttempts.roundId, target.roundId),
        eq(roundJudgingAttempts.judgeParticipantId, target.judgeParticipantId),
        eq(roundJudgingAttempts.stage, 'first'),
        eq(roundJudgingAttempts.outcome, 'dispatched'),
      ),
    )
    .limit(1);
  const claimedAt = await readDatabaseTime(tx);
  const leaseExpiresAt = new Date(claimedAt.getTime() + input.leaseMs);
  await tx
    .update(roundJudgingJobs)
    .set({
      commandId,
      status: 'leased',
      attempts: epoch,
      model,
      retryAt: null,
      lastClaimedAt: claimedAt,
      recoveryReason: null,
      ...(firstPassLost(job, priorFirstAttempt)
        ? { firstBallotFailed: true }
        : {}),
      ...(job.status === 'recovering' && !job.pendingBallot
        ? {
            generationDeadlineAt: new Date(
              claimedAt.getTime() + judgingPolicy.aiBudgetMs,
            ),
            generationFirstEpoch: epoch,
          }
        : {}),
      leaseTokenDigest: agentLeaseDigest(token),
      leaseExpiresAt,
    })
    .where(judgingJobWhere(target));
  return {
    scope,
    token,
    leaseExpiresAt: leaseExpiresAt.toISOString(),
    expectedVersion: round.version,
    model,
    pendingBallot: job.pendingBallot,
    frozen,
    round,
  };
}
