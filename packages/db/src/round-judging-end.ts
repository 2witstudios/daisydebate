import { and, eq, inArray, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { roundJudgingJobs } from './schema/round-judging-jobs';

/**
 * Whether a job can still produce or submit a ballot: it has generation budget,
 * or it holds a validated ballot that has had its chance to submit. A held
 * ballot waits out attendance, so its bound runs from whichever is latest: the
 * attendance cutoff, the last attendance decision, or the last uncertain writer
 * resolving, plus a grace for a worker to submit. Only past that does a ballot
 * that can never submit stop holding the Round. One rule for the panel and the
 * room; reads round_judging_jobs by name.
 */
export const judgingJobCanRule = sql`(round_judging_jobs.status in ('queued','leased') and (
  round_judging_jobs.generation_deadline_at>clock_timestamp()
  or (round_judging_jobs.pending_ballot is not null and coalesce(
    (select greatest(
      cutoff_round.attendance_resolution_cutoff_at,
      (select max(decided.applied_at) from round_attendance_adjudications decision
        join round_commands decided on decided.command_id=decision.command_id and decided.round_id=decision.round_id
        where decision.round_id=cutoff_round.id)+interval '10 minutes',
      (select max(writer.resolved_at) from round_check_in_attempts writer where writer.round_id=cutoff_round.id)+interval '10 minutes'
    )>clock_timestamp() from rounds cutoff_round where cutoff_round.id=round_judging_jobs.round_id),true))))`;

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
  return tx
    .update(roundJudgingJobs)
    .set({
      status: 'failed',
      // Past its budget with no ballot, the budget ended it, not the Round.
      terminalReason: sql`case when ${roundJudgingJobs.pendingBallot} is null and ${roundJudgingJobs.generationDeadlineAt}<=clock_timestamp() then 'generation_deadline' else 'round_ended' end`,
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
    )
    .returning({ reason: roundJudgingJobs.terminalReason });
}
