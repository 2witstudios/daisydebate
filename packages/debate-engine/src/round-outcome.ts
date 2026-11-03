import { createAppError } from '@daisy/errors';
import type { DebateSide, JudgeRuling } from '@daisy/protocol';

type Seat = { readonly id: string; readonly role: string };
/** Every required seat must supply exactly one valid ruling. A tie has no winner: there are no draws (DEC-277). */
export function deriveRoundOutcome(
  seats: readonly Seat[],
  ballots: readonly JudgeRuling[],
): DebateSide | null {
  const required = seats
    .filter((seat) => seat.role === 'judge')
    .map((seat) => seat.id);
  const assigned = new Set(required);
  const supplied = new Set(ballots.map((ballot) => ballot.judgeParticipantId));
  if (
    required.length === 0 ||
    assigned.size !== required.length ||
    supplied.size !== ballots.length ||
    ballots.length !== required.length ||
    ballots.some((ballot) => !assigned.has(ballot.judgeParticipantId))
  )
    throw createAppError(
      'INVARIANT',
      'Every assigned judge requires one submitted ballot',
    );
  const affirmative = ballots.filter(
    (ballot) => ballot.winner === 'affirmative',
  ).length;
  const negative = ballots.length - affirmative;
  return affirmative === negative
    ? null
    : affirmative > negative
      ? 'affirmative'
      : 'negative';
}

/** The exact rulings admitted by the partial finalizer; preserves caller-owned IDs. */
export const participatingRulings = <
  T extends Pick<JudgeRuling, 'judgeParticipantId'>,
>(
  judgeSeatIds: readonly string[],
  ballots: readonly T[],
): readonly T[] =>
  ballots.filter((ballot) => judgeSeatIds.includes(ballot.judgeParticipantId));
