import type { JudgingTerminalReason, RoundEnding } from '@daisy/protocol';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { roundJudgingJobs } from './schema/round-judging-jobs';
import { judgingJobWhere } from './round-judging-context';

/** The engine's rule: judging names why a Round's end ended a job. */
export type JudgingEndRule = (
  job: { readonly generationDeadlineAt: string; readonly holdsBallot: boolean },
  ending: RoundEnding,
  nowMs: number,
) => JudgingTerminalReason;

/**
 * A judging job still open when its Round ends has ended too. The caller says
 * how the Round ended, and the injected judging rule names the reason.
 */
export async function endOpenJudgingJobs(
  tx: Pick<BunSQLDatabase, 'update' | 'execute' | 'select'>,
  input: {
    readonly roundId: string;
    readonly ending: RoundEnding;
    readonly now: string;
    readonly judgingEndReason: JudgingEndRule;
  },
): Promise<readonly JudgingTerminalReason[]> {
  const { roundId } = input;
  const open = await tx
    .select({
      judgeParticipantId: roundJudgingJobs.judgeParticipantId,
      generationDeadlineAt: roundJudgingJobs.generationDeadlineAt,
      holdsBallot: sql<boolean>`${roundJudgingJobs.pendingBallot} is not null`,
    })
    .from(roundJudgingJobs)
    .where(
      and(
        eq(roundJudgingJobs.roundId, roundId),
        inArray(roundJudgingJobs.status, ['queued', 'leased']),
      ),
    )
    .for('update');
  // A job's run ends with it, or a dead lease reads as still running.
  await tx.execute(sql`update agent_runs set ended_at=clock_timestamp()
    where kind='judging' and ended_at is null and round_participant_id in (
      select judge_participant_id from round_judging_jobs
      where round_id=${roundId} and status in ('queued','leased'))`);
  const nowMs = Date.parse(input.now);
  const reasons: JudgingTerminalReason[] = [];
  for (const job of open) {
    const terminalReason = input.judgingEndReason(
      {
        generationDeadlineAt: job.generationDeadlineAt.toISOString(),
        holdsBallot: job.holdsBallot,
      },
      input.ending,
      nowMs,
    );
    await tx
      .update(roundJudgingJobs)
      .set({
        status: 'failed',
        terminalReason,
        retryAt: null,
        leaseTokenDigest: null,
        leaseExpiresAt: null,
        pendingBallot: null,
        pendingBallotAgentRunId: null,
        pendingBallotEpoch: null,
        pendingBallotReceivedAt: null,
      })
      .where(
        judgingJobWhere({
          roundId,
          judgeParticipantId: job.judgeParticipantId,
        }),
      );
    reasons.push(terminalReason);
  }
  return reasons;
}
