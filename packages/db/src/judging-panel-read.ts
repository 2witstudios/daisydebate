import { createAppError } from '@daisy/errors';
import type { JudgingPanelFacts } from '@daisy/protocol';
import { eq, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { ballots } from './schema/ballots';
import { roundJudgingJobs } from './schema/round-judging-jobs';

type JudgeSeat = {
  readonly id: string;
  readonly role: string;
  readonly kind: string;
};
const iso = (column: string) =>
  sql.raw(
    `to_char(${column} at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`,
  );

/**
 * Facts only, for the engine's one panel decision: the Round's completion and
 * its read both come through here. The Round is frozen, so its final speech has
 * ended and rounds_attendance_cutoff_check guarantees a cutoff; a missing one
 * is corruption, never a hold without end.
 */
export async function readJudgingPanelFacts(
  tx: Pick<BunSQLDatabase, 'select' | 'execute'>,
  input: {
    readonly roundId: string;
    readonly completeness: JudgingPanelFacts['completeness'];
    readonly seats: readonly JudgeSeat[];
  },
): Promise<JudgingPanelFacts> {
  const { roundId } = input;
  const [round] = (await tx.execute(sql`select
    ${iso('r.ballot_deadline_at')} as "ballotDeadlineAt",
    ${iso('r.attendance_resolution_cutoff_at')} as "attendanceCutoffAt",
    (select ${iso('max(decided.applied_at)')} from round_attendance_adjudications decision
      join round_commands decided on decided.command_id=decision.command_id and decided.round_id=decision.round_id
      where decision.round_id=r.id) as "lastAttendanceDecisionAt",
    (select ${iso('max(writer.resolved_at)')} from round_check_in_attempts writer
      where writer.round_id=r.id) as "lastWriterResolvedAt"
    from rounds r where r.id=${roundId}`)) as unknown as {
    ballotDeadlineAt: string | null;
    attendanceCutoffAt: string | null;
    lastAttendanceDecisionAt: string | null;
    lastWriterResolvedAt: string | null;
  }[];
  if (!round?.attendanceCutoffAt)
    throw createAppError(
      'INVARIANT',
      'A frozen Round has no attendance cutoff',
    );
  const jobs = await tx
    .select({
      judgeParticipantId: roundJudgingJobs.judgeParticipantId,
      status: roundJudgingJobs.status,
      generationDeadlineAt: roundJudgingJobs.generationDeadlineAt,
      holdsBallot: sql<boolean>`${roundJudgingJobs.pendingBallot} is not null`,
    })
    .from(roundJudgingJobs)
    .where(eq(roundJudgingJobs.roundId, roundId));
  const judges = input.seats.filter((seat) => seat.role === 'judge');
  return {
    completeness: input.completeness,
    humanJudgeSeatIds: judges
      .filter((seat) => seat.kind === 'human')
      .map((seat) => seat.id),
    aiJudgeSeatIds: judges
      .filter((seat) => seat.kind !== 'human')
      .map((seat) => seat.id),
    ballotDeadlineAt: round.ballotDeadlineAt,
    jobs: jobs.map((job) => ({
      ...job,
      generationDeadlineAt: job.generationDeadlineAt.toISOString(),
    })),
    held: {
      attendanceCutoffAt: round.attendanceCutoffAt,
      lastAttendanceDecisionAt: round.lastAttendanceDecisionAt,
      lastWriterResolvedAt: round.lastWriterResolvedAt,
    },
    ballots: (await tx
      .select({
        judgeParticipantId: ballots.judgeParticipantId,
        winner: ballots.winner,
        status: ballots.status,
      })
      .from(ballots)
      .where(eq(ballots.roundId, roundId))) as JudgingPanelFacts['ballots'],
  };
}
