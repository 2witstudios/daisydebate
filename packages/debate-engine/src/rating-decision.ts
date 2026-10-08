import { createAppError } from '@daisy/errors';
import type {
  DebaterStanding,
  RatingEligibility,
  RatingEligibilityFacts,
  RatingPlan,
  RatingPlanFacts,
  RatingState,
} from '@daisy/protocol';
import { carryOver, rateDebate, postingInstant, ratingPolicy } from './rating';

/**
 * The domain decisions behind rating one completed round (ADR 0055,
 * ADR 0058), as pure functions over facts the persistence adapter loads
 * from the round's frozen columns. The adapter locks, reads and writes;
 * every rule (who rates, on which ladder, from which starting state, to
 * which result) is decided here.
 */

/**
 * Whether a round rates, and on which ladder. Ratedness has one authority:
 * the round's frozen `ladder_id`, whose derivation the schema constrains —
 * a casual or practice round carries none and never rates. Ranked
 * eligibility was decided when the round was constructed from a sanctioned
 * preset, so this check re-decides nothing about the format; a mismatch
 * there is corruption and fails as an invariant in the adapter's
 * `assertRatedRoundIntegrity`, never as an unrated reason. A forfeit
 * carries a side outcome and rates like a judged result.
 */
export function ratingEligibility(
  input: RatingEligibilityFacts,
): RatingEligibility {
  if (input.status === 'abandoned')
    return { kind: 'unrated', reason: 'abandoned' };
  if (input.status !== 'completed')
    throw createAppError('CONFLICT', 'Only a completed round can be rated');
  // Before the ladder: a rerun after the ledger moved is still a rerun.
  if (input.alreadyRated) return { kind: 'already-rated' };
  if (input.ladderId === null)
    return { kind: 'unrated', reason: 'competition' };
  if (input.outcome === null || input.completedAt === null)
    throw createAppError('CONFLICT', 'A completed round has no outcome');
  return {
    kind: 'rated',
    ladder: input.ladderId,
    outcome: input.outcome,
    occurredAt: input.completedAt,
  };
}

/** This season's row, else the last season carried over, else a newcomer. */
const startingState = ({ current, previous }: DebaterStanding): RatingState =>
  current?.state ?? (previous ? carryOver(previous) : ratingPolicy.initial);

/**
 * The ledger changes for a rated debate: one per side, in side order, each
 * starting from the debater's standing and computed by `rateDebate`.
 */
export function planRating(input: RatingPlanFacts): RatingPlan {
  if (input.seasonId === null)
    throw createAppError('CONFLICT', 'No season is active');
  const seatOf = (role: 'affirmative' | 'negative') => {
    const held = input.seats.filter((seat) => seat.role === role);
    if (held.length !== 1 || !held[0])
      throw createAppError(
        'CONFLICT',
        'A rated debate needs one debater on each side',
      );
    return held[0].actorId;
  };
  const affirmative = seatOf('affirmative');
  const negative = seatOf('negative');
  if (affirmative === negative)
    throw createAppError('CONFLICT', 'A debater cannot hold both sides');
  const standingOf = (actorId: string): DebaterStanding => {
    const standing = input.standings[actorId];
    if (!standing)
      throw createAppError('INTERNAL', 'A seated debater has no standing');
    return standing;
  };
  const affirmativeStanding = standingOf(affirmative);
  const negativeStanding = standingOf(negative);
  const postedAt = postingInstant(input.occurredAt, [
    affirmativeStanding.lastRatedAt,
    negativeStanding.lastRatedAt,
  ]);
  const rated = rateDebate({
    affirmative: {
      state: startingState(affirmativeStanding),
      lastRatedAt: affirmativeStanding.lastRatedAt,
    },
    negative: {
      state: startingState(negativeStanding),
      lastRatedAt: negativeStanding.lastRatedAt,
    },
    outcome: input.outcome,
    occurredAt: postedAt,
  });
  const [affirmativeId, negativeId] = input.changeIds;
  return {
    ladder: input.ladder,
    seasonId: input.seasonId,
    occurredAt: postedAt,
    calculationVersion: rated.calculationVersion,
    changes: [
      {
        changeId: affirmativeId,
        actorId: affirmative,
        ...rated.affirmative,
        expectedVersion: affirmativeStanding.current?.version ?? null,
      },
      {
        changeId: negativeId,
        actorId: negative,
        ...rated.negative,
        expectedVersion: negativeStanding.current?.version ?? null,
      },
    ],
  };
}
