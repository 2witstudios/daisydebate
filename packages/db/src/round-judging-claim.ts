import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { BoundedTransactionContext } from './transaction-context';
import { agentRuns } from './schema/agent-runs';
import { roundJudgingJobs } from './schema/round-judging-jobs';
import { readLockedFrozenRoundTranscript } from './frozen-transcript';
import { agentLeaseDigest } from './round-agent-lease';
import {
  endLockedRoundAgentRun,
  lockRoundAgentContext,
  roundAgentNow,
  startLockedRoundAgentRun,
} from './round-agent-runs';
import { judgingJobWhere, type JudgingScope } from './round-judging-context';
import { nextEpoch } from './lease-policy';

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
  const now = await roundAgentNow(tx);
  requireClaimableJob(job, commandId, now);
  const frozen = await readLockedFrozenRoundTranscript(tx, round.id);
  if (!frozen || frozen.revision !== job.freezeRevision)
    throw createAppError('CONFLICT', 'Frozen judging input changed');
  const epoch = nextEpoch(job.attempts, 'Judging epoch exhausted');
  for (const prior of priorRuns)
    await endLockedRoundAgentRun(tx, prior.id, seat.id);
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
    model: input.model,
    configuration: {
      ...scope,
      executionTokenDigest: agentLeaseDigest(token),
      providerOutcome: 'not_started',
    },
  });
  const leaseExpiresAt = new Date(now.getTime() + input.leaseMs);
  await tx
    .update(roundJudgingJobs)
    .set({
      commandId,
      status: 'leased',
      attempts: epoch,
      leaseTokenDigest: agentLeaseDigest(token),
      leaseExpiresAt,
    })
    .where(judgingJobWhere(target));
  return {
    scope,
    token,
    leaseExpiresAt: leaseExpiresAt.toISOString(),
    expectedVersion: round.version,
    model: input.model,
    pendingBallot: job.pendingBallot,
    frozen,
    round,
  };
}

function requireClaimableJob(
  job: typeof roundJudgingJobs.$inferSelect | undefined,
  commandId: string,
  now: Date,
): asserts job is typeof roundJudgingJobs.$inferSelect {
  if (
    !job ||
    (job.commandId !== null && job.commandId !== commandId) ||
    !['queued', 'leased'].includes(job.status) ||
    (job.leaseExpiresAt && job.leaseExpiresAt.getTime() > now.getTime())
  )
    throw createAppError('CONFLICT', 'Judging intent unavailable');
}
