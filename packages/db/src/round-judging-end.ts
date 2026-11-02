import { and, eq, inArray, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { roundJudgingJobs } from './schema/round-judging-jobs';

/**
 * Whether a job can still produce or submit a ballot: it has generation budget,
 * or holds a validated ballot and the attendance cutoff has not passed. Past
 * that a ballot that can never submit stops holding the Round. Reads from
 * round_judging_jobs by name; one rule for the panel decision and the room.
 */
export const judgingJobCanRule = sql`(round_judging_jobs.status in ('queued','leased') and (
  round_judging_jobs.generation_deadline_at>clock_timestamp()
  or (round_judging_jobs.pending_ballot is not null and coalesce(
    (select cutoff_round.attendance_resolution_cutoff_at>clock_timestamp() from rounds cutoff_round where cutoff_round.id=round_judging_jobs.round_id),true))))`;

/** A judging job still open when its Round ends has ended too, with that reason. */
export async function endOpenJudgingJobs(
  tx: Pick<BunSQLDatabase, 'update' | 'execute'>,
  roundId: string,
) {
  // A job's run ends with it, or a dead lease reads as still running.
  await tx.execute(sql`update agent_runs set ended_at=clock_timestamp()
    where kind='judging' and ended_at is null and round_participant_id in (
      select judge_participant_id from round_judging_jobs
      where round_id=${roundId} and status in ('queued','leased'))`);
  await tx
    .update(roundJudgingJobs)
    .set({
      status: 'failed',
      terminalReason: 'round_ended',
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
        eq(roundJudgingJobs.roundId, roundId),
        inArray(roundJudgingJobs.status, ['queued', 'leased']),
      ),
    );
}
