import { instantMs } from '@daisy/clock/instant';
import { createAppError } from '@daisy/errors';
import {
  affirmativeSide,
  negativeSide,
  sideOfSeat,
  type SideKey,
} from '@daisy/protocol/seats';
import { rateableOutcome, winnerOutcome } from '@daisy/protocol/round-outcome';
import type {
  DebaterStanding,
  EndingRating,
  EndingRatingFacts,
  RatingEligibility,
  RatingCompetition,
  RatingEligibilityFacts,
  RatingPlan,
  RatingPlanFacts,
  RatingState,
} from '@daisy/protocol/ratings';
import { attendanceSettled } from './attendance-order';
import {
  carryOver,
  rateDebateSides,
  postingInstant,
  ratingPolicy,
} from './rating';

/**
 * The domain decisions behind rating one completed round (ADR 0055,
 * ADR 0058), as pure functions over facts the persistence adapter loads.
 * The adapter selects candidates, locks, reads and writes; every rule (who
 * rates, on which ladder, from which starting state, to which result) is
 * decided here.
 */

/** Only two named sides participate in the existing pairwise rating calculation. */
export function ratingCompetition(
  sides: readonly SideKey[],
): RatingCompetition {
  const [first, second] = sides;
  return sides.length === 2 && first && second
    ? { kind: 'rated', sides: [first, second] }
    : { kind: 'unrated', reason: 'competition' };
}

/** DEC-111 leaves prior-season carry-over closed until its standing rules are approved. */
export function requireRatingStandingRules(input: {
  readonly previousWithoutRules: boolean;
}): void {
  if (input.previousWithoutRules)
    throw createAppError(
      'CONFLICT',
      'Season carry-over requires DEC-111 resolution',
    );
}

/** A Round rates on its frozen pool when its ending supports a result. */
export function ratingEligibility(
  input: RatingEligibilityFacts,
): RatingEligibility {
  if (input.status === 'abandoned')
    return { kind: 'unrated', reason: 'abandoned' };
  if (input.status !== 'completed')
    throw createAppError('CONFLICT', 'Only a completed round can be rated');
  // Before the ladder: a rerun after the ledger moved is still a rerun.
  if (input.alreadyRated) return { kind: 'already-rated' };
  if (input.scope === null) return { kind: 'unrated', reason: 'competition' };
  const ending = endingRating(input);
  return ending.kind === 'rated' ? { ...ending, scope: input.scope } : ending;
}

/**
 * Whether a Round's ending rates on any ladder: Daisy's own, or a league's
 * (one rule, so a Round Daisy refuses never feeds a league ladder). A forfeit
 * carries a side outcome and rates with no attendance settlement to wait for.
 * A decisive ballot rates on any capture (DEC-329): the judge ruled, and a
 * capture failure does not cost a ranked result. A null outcome is a real
 * ending with no result (DEC-277).
 */
export function endingRating(input: EndingRatingFacts): EndingRating {
  if (input.status === 'abandoned')
    return { kind: 'unrated', reason: 'abandoned' };
  if (input.status !== 'completed')
    throw createAppError('CONFLICT', 'Only a completed round can be rated');
  // A rating compares two sides: only a winner rates (ADR 0055, TAB-6.2).
  const outcome = rateableOutcome(input.outcome);
  if (outcome === null) return { kind: 'unrated', reason: 'no-result' };
  if (input.ending === 'unrecorded')
    return { kind: 'unrated', reason: 'ending-unrecorded' };
  if (input.attendance.pendingWriter)
    return { kind: 'unrated', reason: 'check-in-pending' };
  if (input.ending === 'unjudged')
    return { kind: 'unrated', reason: 'unjudged' };
  if (
    input.ending === 'judged' &&
    !attendanceSettled(input.attendance, instantMs(input.completedAt))
  )
    return { kind: 'attendance-unsettled' };
  return { kind: 'rated', outcome, occurredAt: input.completedAt };
}

/**
 * Whether a rating is due now. False while a check-in writer is in doubt: the
 * Round is read again once that resolves.
 */
export function ratingAwaited(input: RatingEligibilityFacts): boolean {
  if (input.status !== 'completed') return false;
  const { kind } = ratingEligibility(input);
  return kind === 'rated' || kind === 'attendance-unsettled';
}

/** This season's row, else the last season carried over, else a newcomer. */
const startingState = ({ current, previous }: DebaterStanding): RatingState =>
  current?.state ?? (previous ? carryOver(previous) : ratingPolicy.initial);

/** Plans one ledger change per debater from both sides' pre-game states. */
export function planRating(input: RatingPlanFacts): RatingPlan {
  const standingOf = (actorId: string) => {
    const standing = input.standings[actorId];
    const changeId = input.changeIds[actorId];
    if (!standing || !changeId)
      throw createAppError(
        'INTERNAL',
        'A seated debater has incomplete rating facts',
      );
    return {
      actorId,
      changeId,
      state: startingState(standing),
      lastRatedAt: standing.lastRatedAt,
      expectedVersion: standing.current?.version ?? null,
    };
  };
  const onSide = (side: SideKey) =>
    input.seats.filter((seat) => sideOfSeat(seat.seat) === side);
  const [first, second] = input.sides;
  const winner = input.outcome.side;
  if (first === second || (winner !== first && winner !== second))
    throw createAppError('CONFLICT', 'A rated debate needs a winning side');
  const affirmativeSeats = onSide(first);
  const negativeSeats = onSide(second);
  const actors = [...affirmativeSeats, ...negativeSeats].map(
    ({ actorId }) => actorId,
  );
  if (actors.length !== new Set(actors).size)
    throw createAppError('CONFLICT', 'A debater cannot hold multiple seats');
  const affirmative = affirmativeSeats.map(({ actorId }) =>
    standingOf(actorId),
  );
  const negative = negativeSeats.map(({ actorId }) => standingOf(actorId));
  const postedAt = postingInstant(input.occurredAt, [
    ...affirmative.map(({ lastRatedAt }) => lastRatedAt),
    ...negative.map(({ lastRatedAt }) => lastRatedAt),
  ]);
  const rated = rateDebateSides({
    affirmative,
    negative,
    outcome: winnerOutcome(winner === first ? affirmativeSide : negativeSide),
    occurredAt: postedAt,
  });
  const ledger = (
    side: typeof affirmative,
    changes: typeof rated.affirmative,
  ) =>
    side.map(({ actorId, changeId, expectedVersion }, index) => ({
      actorId,
      changeId,
      ...changes[index]!,
      expectedVersion,
    }));
  return {
    scope: input.scope,
    occurredAt: postedAt,
    calculationVersion: rated.calculationVersion,
    changes: [
      ...ledger(affirmative, rated.affirmative),
      ...ledger(negative, rated.negative),
    ],
  };
}
