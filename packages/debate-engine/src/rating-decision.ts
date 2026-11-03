import { createAppError } from '@daisy/errors';
import type {
  DebaterStanding,
  RatingEligibility,
  RatingEligibilityFacts,
  RatingPlan,
  RatingPlanFacts,
  RatingState,
} from '@daisy/protocol';
import { attendanceSettled } from './attendance-order';
import { carryOver, rateDebate, postingInstant, ratingPolicy } from './rating';

/**
 * The domain decisions behind rating one completed round (ADR 0055,
 * ADR 0058), as pure functions over facts the persistence adapter loads.
 * The adapter selects candidates, locks, reads and writes; every rule (who
 * rates, on which ladder, from which starting state, to which result) is
 * decided here.
 */

/**
 * Whether a round rates, and on which ladder. Ratedness has one authority:
 * the round's frozen `ladder_id`, whose derivation the schema constrains —
 * a casual round carries none and never rates. Ranked
 * eligibility was decided when the round was constructed from a sanctioned
 * preset, so this check re-decides nothing about the format; a mismatch
 * there is corruption and fails as an invariant in the adapter's
 * `assertRatedRoundIntegrity`, never as an unrated reason. A forfeit
 * carries a side outcome and rates like a judged result, on any capture and
 * with no attendance settlement to wait for. A ballot rates only on a complete
 * capture: DEC-285 holds that until the owner rules on ISSUE-911. A null
 * outcome is a real ending with no result (DEC-277).
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
    return { kind: 'unrated', reason: 'no-result' };
  if (input.ending === 'unrecorded')
    return { kind: 'unrated', reason: 'ending-unrecorded' };
  if (input.attendance.pendingWriter)
    return { kind: 'unrated', reason: 'check-in-pending' };
  if (input.ending === 'unjudged')
    return { kind: 'unrated', reason: 'unjudged' };
  if (input.ending === 'judged-on-incomplete-capture')
    return { kind: 'unrated', reason: 'incomplete-capture' };
  if (
    input.ending === 'judged-on-complete-capture' &&
    !attendanceSettled(input.attendance, Date.parse(input.completedAt))
  )
    return { kind: 'attendance-unsettled' };
  return {
    kind: 'rated',
    ladder: input.ladderId,
    outcome: input.outcome,
    occurredAt: input.completedAt,
  };
}

/** Whether this Round still has a rating coming. */
export function ratingAwaited(input: RatingEligibilityFacts): boolean {
  if (input.status !== 'completed') return false;
  const { kind } = ratingEligibility(input);
  return kind === 'rated' || kind === 'attendance-unsettled';
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
