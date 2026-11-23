import { currentRoundParticipant } from './round-current-participant';
import { and, eq } from 'drizzle-orm';
import { agentRuns } from './schema/agent-runs';
import { roundJudgingJobs } from './schema/round-judging-jobs';
import { requireLeaseToken } from './lease';
import { readDatabaseTime } from './database-clock';
import {
  requireCurrentJob,
  requireCurrentRun,
  requireJudgingService,
  requireLiveJudgingLease,
} from './round-judging-decisions';
import type { Tx } from './tx';

export type JudgingScope = {
  readonly roundId: string;
  readonly judgeParticipantId: string;
  readonly agentRunId: string;
  readonly serviceId: string;
  readonly commandId: string;
  readonly freezeRevision: number;
  readonly jobEpoch: number;
};
export const judgingJobWhere = (
  scope: Pick<JudgingScope, 'roundId' | 'judgeParticipantId'>,
) =>
  and(
    eq(roundJudgingJobs.roundId, scope.roundId),
    eq(roundJudgingJobs.judgeParticipantId, scope.judgeParticipantId),
  );
/** Caller owns account/Round fences. Run then job order also matches D1 result submission. */
export async function assertLockedJudgingLease(
  tx: Tx,
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
    .where(
      and(
        judgingJobWhere(scope),
        currentRoundParticipant(roundJudgingJobs.judgeParticipantId),
      ),
    )
    .for('update');
  requireCurrentJob(job, scope);
  requireLeaseToken(token, job.leaseTokenDigest ?? '');
  // Sample AFTER the job lock wait; the D1 context clock is insufficient here.
  const now = await readDatabaseTime(tx);
  requireLiveJudgingLease(job, now);
  requireCurrentRun(run, scope);
  return { job, run, now };
}
