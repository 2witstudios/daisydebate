import { currentRoundParticipant } from './round-current-participant';
import { createAppError } from '@daisy/errors';
import type { JudgingPanelFacts } from '@daisy/protocol';
import { and, eq, sql } from 'drizzle-orm';
import { ballots } from './schema/ballots';
import { roundJudgingJobs } from './schema/round-judging-jobs';
import type { Tx } from './tx';

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
  tx: Tx,
  input: {
    readonly roundId: string;
    readonly completeness: JudgingPanelFacts['completeness'];
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
      where writer.round_id=r.id) as "lastWriterResolvedAt",
    r.judging as "judging"
    from rounds r where r.id=${roundId}`)) as unknown as {
    judging: JudgingPanelFacts['judging'] | null;
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
    .where(
      and(
        eq(roundJudgingJobs.roundId, roundId),
        currentRoundParticipant(roundJudgingJobs.judgeParticipantId),
      ),
    );
  const judges =
    (await tx.execute(sql`select s.slot,p.id,a.kind from round_judge_slots s
    left join round_participants p on p.id=s.participant_id
    left join actors a on a.id=p.actor_id
    where s.round_id=${roundId} order by s.slot`)) as unknown as {
      slot: number;
      id: string | null;
      kind: string | null;
    }[];
  const rulings = await tx
    .select({
      judgeParticipantId: ballots.judgeParticipantId,
      decision: ballots.decision,
      winner: ballots.winner,
      ranking: ballots.ranking,
    })
    .from(ballots)
    .where(eq(ballots.roundId, roundId));
  return {
    judging: round.judging,
    completeness: input.completeness,
    emptyJudgeSlots: judges
      .filter((seat) => seat.id === null)
      .map((seat) => seat.slot),
    humanJudgeSeatIds: judges.flatMap((seat) =>
      seat.id !== null && seat.kind === 'human' ? [seat.id] : [],
    ),
    aiJudgeSeatIds: judges.flatMap((seat) =>
      seat.id !== null && seat.kind === 'bot' ? [seat.id] : [],
    ),
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
    // A winner ballot names its side (null for a tie or a double loss); a
    // ranking ballot gives its places.
    ballots: rulings.map(({ judgeParticipantId, decision, winner, ranking }) =>
      decision === 'ranking'
        ? { judgeParticipantId, ranking: ranking ?? [] }
        : { judgeParticipantId, winner },
    ),
  };
}
