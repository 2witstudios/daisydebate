import { createAppError } from '@daisy/errors';
import type {
  DebaterStanding,
  RatingEligibility,
  RatingEligibilityFacts,
  RatingPlan,
  RatingPlanFacts,
  RatingState,
} from '@daisy/protocol';
import {
  carryOver,
  ladderForMode,
  rateDebate,
  ratedAfter,
  ratingPolicy,
} from './rating';
import { rulesMatchFormat } from './rules-match';

/**
 * The domain decisions behind rating one completed debate (ADR 0055), as
 * pure functions over facts the persistence adapter loads. The adapter
 * locks, reads and writes; every rule (who rates, on which ladder, from
 * which starting state, to which result) is decided here.
 */

/**
 * Whether a debate rates, and on which ladder. Ranked and Quick match rate;
 * casual and practice never do. Abandoned debates and debates off canonical
 * rules on a ranked-eligible format never rate. A forfeit carries a side
 * outcome and rates like a judged result.
 */
export function ratingEligibility(
  input: RatingEligibilityFacts,
): RatingEligibility {
  if (input.phase !== 'completed')
    throw createAppError('CONFLICT', 'Only a completed debate can be rated');
  const ladder = ladderForMode(input.mode);
  if (ladder === null) return { kind: 'unrated', reason: 'mode' };
  if (input.outcome === 'abandoned')
    return { kind: 'unrated', reason: 'abandoned' };
  if (
    !input.format.rankedEligible ||
    !rulesMatchFormat(input.rules, input.format.rules)
  )
    return { kind: 'unrated', reason: 'rules' };
  if (input.alreadyRated) return { kind: 'already-rated' };
  if (input.outcome === null || input.completedAt === null)
    throw createAppError('CONFLICT', 'A completed debate has no outcome');
  return {
    kind: 'rated',
    ladder,
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
  // The ledger is ordered by completion: a debate that completed before a
  // debater's last rating would rewrite history, so it is refused.
  if (
    ratedAfter(affirmativeStanding.lastRatedAt, input.occurredAt) ||
    ratedAfter(negativeStanding.lastRatedAt, input.occurredAt)
  )
    throw createAppError(
      'CONFLICT',
      'A debater was already rated for a later debate',
    );
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
    occurredAt: input.occurredAt,
  });
  const [affirmativeId, negativeId] = input.changeIds;
  return {
    ladder: input.ladder,
    seasonId: input.seasonId,
    occurredAt: input.occurredAt,
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
