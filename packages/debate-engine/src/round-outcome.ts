import { createAppError } from '@daisy/errors';
import {
  isJudgeSeat,
  type JudgeRuling,
  type RoundJudging,
  type RoundOutcome,
  type RoundRules,
  type SeatRef,
} from '@daisy/protocol';

type Seat = { readonly id: string; readonly seat: SeatRef };
type Judging = NonNullable<RoundJudging>;

/**
 * Whether a forfeit hands the win to the other side: only in a two-sided
 * Round decided by a winner (TAB-6.2). Anywhere else a debater who leaves is
 * absent and the Round goes on.
 */
export const forfeitsToOpponent = (
  rules: Pick<RoundRules, 'sides' | 'outcome'>,
): boolean => rules.outcome.kind === 'winner' && rules.sides.length === 2;

/**
 * The majority rule: the side a strict majority of the submitted ballots
 * names. A tie or a double loss votes for no side, so a panel with no strict
 * majority has no winner (DEC-277).
 */
const majorityOutcome = (
  ballots: readonly JudgeRuling[],
): RoundOutcome | null => {
  const votes = new Map<string, number>();
  for (const ballot of ballots)
    if ('winner' in ballot && ballot.winner !== null)
      votes.set(ballot.winner, (votes.get(ballot.winner) ?? 0) + 1);
  const [side] =
    [...votes].find(([, count]) => count * 2 > ballots.length) ?? [];
  return side === undefined ? null : { kind: 'winner', side };
};

/**
 * The rank-sum rule: each subject's places summed over the ballots, lowest
 * first; equal sums share a place.
 */
const rankSumOutcome = (
  of: 'sides' | 'speakers',
  ballots: readonly JudgeRuling[],
): RoundOutcome | null => {
  const sums = new Map<string, number>();
  const ranked = ballots.flatMap((ballot) =>
    'ranking' in ballot ? [ballot.ranking] : [],
  );
  for (const places of ranked)
    places.forEach((group, index) => {
      for (const subject of group)
        sums.set(subject, (sums.get(subject) ?? 0) + index + 1);
    });
  if (ranked.length === 0 || sums.size === 0) return null;
  const order = [...new Set(sums.values())].sort((a, b) => a - b);
  return {
    kind: 'ranking',
    of,
    places: order.map((sum) =>
      [...sums]
        .filter(([, total]) => total === sum)
        .map(([subject]) => subject),
    ),
  };
};

/**
 * Every required seat must supply exactly one valid ruling; the frozen panel
 * rule then decides. A tie has no winner: there are no draws (DEC-277).
 */
export function deriveRoundOutcome(
  judging: Judging,
  seats: readonly Seat[],
  ballots: readonly JudgeRuling[],
): RoundOutcome | null {
  const required = seats
    .filter((seat) => isJudgeSeat(seat.seat))
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
  switch (judging.panel.decision) {
    case 'majority':
      return majorityOutcome(ballots);
    case 'rank_sum':
      return rankSumOutcome(
        judging.ballot.decision.kind === 'ranking'
          ? judging.ballot.decision.of
          : 'sides',
        ballots,
      );
  }
}

/** The exact rulings admitted by the partial finalizer; preserves caller-owned IDs. */
export const participatingRulings = <
  T extends Pick<JudgeRuling, 'judgeParticipantId'>,
>(
  judgeSeatIds: readonly string[],
  ballots: readonly T[],
): readonly T[] =>
  ballots.filter((ballot) => judgeSeatIds.includes(ballot.judgeParticipantId));
