import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { TabTransaction } from './tab/tab-transaction';
import { agentRuns } from './schema/agent-runs';
import { roundJudgingJobs } from './schema/round-judging-jobs';
import { settleCasualJudgeUsageLocked } from './casual-judge-usage';

/** Round/account fences held. Retire authority without erasing usage, deadlines or historical attempts. */
export async function retireLockedRoundJudge(
  tx: TabTransaction,
  input: { readonly roundId: string; readonly participantId: string },
) {
  const runs = await tx
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(
      and(
        eq(agentRuns.roundParticipantId, input.participantId),
        eq(agentRuns.kind, 'judging'),
        isNull(agentRuns.endedAt),
      ),
    )
    .orderBy(agentRuns.id)
    .for('update');
  const [job] = await tx
    .select()
    .from(roundJudgingJobs)
    .where(
      and(
        eq(roundJudgingJobs.roundId, input.roundId),
        eq(roundJudgingJobs.judgeParticipantId, input.participantId),
      ),
    )
    .for('update');
  if (runs.length)
    await tx
      .update(agentRuns)
      .set({ endedAt: sql`clock_timestamp()` })
      .where(
        inArray(
          agentRuns.id,
          runs.map((run) => run.id),
        ),
      );
  if (job && job.status !== 'succeeded' && job.status !== 'failed')
    await tx
      .update(roundJudgingJobs)
      .set({
        status: 'failed',
        terminalReason: 'assignment_retired',
        recoveryReason: null,
        retryAt: null,
        leaseTokenDigest: null,
        leaseExpiresAt: null,
        pendingBallot: null,
        pendingBallotAgentRunId: null,
        pendingBallotEpoch: null,
        pendingBallotReceivedAt: null,
      })
      .where(
        and(
          eq(roundJudgingJobs.roundId, input.roundId),
          eq(roundJudgingJobs.judgeParticipantId, input.participantId),
        ),
      );
  await settleCasualJudgeUsageLocked(tx, input.roundId);
}
