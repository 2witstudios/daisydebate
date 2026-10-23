import { and, eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { agentRuns } from './schema/agent-runs';
import { roundJudgingJobs } from './schema/round-judging-jobs';
import { requireAgentLeaseToken } from './round-agent-lease';
import { roundAgentNow } from './round-agent-runs';
import {
  requireCurrentJob,
  requireCurrentRun,
  requireJudgingService,
  requireLiveJudgingLease,
} from './round-judging-decisions';

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
  requireJudgingService(scope);
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
  requireLiveJudgingLease(job, now);
  requireCurrentRun(run, scope);
  return { job, run, now };
}
