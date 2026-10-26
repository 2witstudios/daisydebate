import { createAppError } from '@daisy/errors';
import type { DebateSide, RatedOutcome } from '@daisy/protocol';

type Seat = { readonly id: string; readonly role: string };
type Ruling = {
  readonly judgeParticipantId: string;
  readonly winner: DebateSide;
  readonly status: 'submitted' | 'voided';
};
/** Every required seat must supply exactly one valid ruling; there is no replacement or void policy here. */
export function deriveRoundOutcome(
  seats: readonly Seat[],
  ballots: readonly Ruling[],
): RatedOutcome {
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
    ballots.some(
      (ballot) =>
        ballot.status !== 'submitted' ||
        !assigned.has(ballot.judgeParticipantId),
    )
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
    ? 'draw'
    : affirmative > negative
      ? 'affirmative'
      : 'negative';
}
