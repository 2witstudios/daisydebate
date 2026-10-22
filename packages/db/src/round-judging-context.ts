import { and, eq } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { agentRuns } from './schema/agent-runs';
import { roundJudgingJobs } from './schema/round-judging-jobs';
import { requireAgentLeaseToken } from './round-agent-lease';
import { roundAgentNow } from './round-agent-runs';

export type JudgingScope = {
  readonly roundId: string;
  readonly judgeParticipantId: string;
  readonly agentRunId: string;
  readonly serviceId: string;
  readonly commandId: string;
  readonly freezeRevision: number;
  readonly jobEpoch: number;
};
export type JudgingReader = Pick<BunSQLDatabase, 'select' | 'execute'>;
export const judgingJobWhere = (
  scope: Pick<JudgingScope, 'roundId' | 'judgeParticipantId'>,
) =>
  and(
    eq(roundJudgingJobs.roundId, scope.roundId),
    eq(roundJudgingJobs.judgeParticipantId, scope.judgeParticipantId),
  );
/** Caller owns account/Round fences. Run then job order also matches D1 result submission. */
export async function assertLockedJudgingLease(
  tx: JudgingReader,
  scope: JudgingScope,
  token: string,
) {
  if (scope.serviceId !== `agent-run:${scope.agentRunId}`)
    throw createAppError('AUTHORIZATION');
  const [run] = await tx
    .select()
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.id, scope.agentRunId),
        eq(agentRuns.roundParticipantId, scope.judgeParticipantId),
      ),
    )
    .for('update');
  const [job] = await tx
    .select()
    .from(roundJudgingJobs)
    .where(judgingJobWhere(scope))
    .for('update');
  requireCurrentJob(job, scope);
  requireAgentLeaseToken(token, job.leaseTokenDigest ?? '');
  // Sample AFTER the job lock wait; the D1 context clock is insufficient here.
  const now = await roundAgentNow(tx);
  if (!job.leaseExpiresAt || job.leaseExpiresAt.getTime() <= now.getTime())
    throw createAppError('CONFLICT', 'Judging lease expired');
  requireCurrentRun(run, scope);
  return { job, run, now };
}

function requireCurrentJob(
  job: typeof roundJudgingJobs.$inferSelect | undefined,
  scope: JudgingScope,
): asserts job is typeof roundJudgingJobs.$inferSelect {
  if (
    !job ||
    job.status !== 'leased' ||
    job.attempts !== scope.jobEpoch ||
    job.freezeRevision !== scope.freezeRevision ||
    job.commandId !== scope.commandId
  )
    throw createAppError('CONFLICT', 'Judging lease changed');
}
function requireCurrentRun(
  run: typeof agentRuns.$inferSelect | undefined,
  scope: JudgingScope,
): asserts run is typeof agentRuns.$inferSelect {
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
