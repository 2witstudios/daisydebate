import { tryInstantMs } from '@daisy/clock';
import { createAppError, createInvariantError } from '@daisy/errors';
import {
  affirmativeSide,
  negativeSide,
  type TwoSideKey,
} from '@daisy/protocol/seats';
import { type WinnerOutcome } from '@daisy/protocol/round-outcome';
import {
  GLICKO2_SCALE,
  ratePeriod,
  type Glicko2Game,
  type Glicko2State,
} from './glicko2';
import { debateInvariantIds } from './invariant-ids';

/**
 * Daisy's rating rules on top of Glicko-2 (ADR 0029 item 8): one debate is
 * one rating period, idle time widens the deviation, a season carries the
 * rating forward with a wider deviation, and every state stays inside the
 * bounds the ledger enforces. `RATING_CALCULATION_VERSION` names exactly
 * this policy; changing any value below means a new version, so the ledger
 * never has to be rewritten.
 */
export const RATING_CALCULATION_VERSION = 'glicko2-v1';

export const ratingPolicy = {
  initial: { rating: 1500, deviation: 350, volatility: 0.06 },
  tau: 0.5,
  epsilon: 1e-6,
  maxIterations: 100,
  /** Idle time is measured in periods of one day. */
  inactivityPeriodMs: 86_400_000,
  /** The least deviation a rating carries into a new season. */
  seasonDeviationFloor: 150,
  /** Above this deviation a rating is provisional (95% range wider than ±220). */
  provisionalDeviation: 110,
  bounds: {
    rating: { min: 0, max: 4000 },
    deviation: { min: 30, max: 350 },
    volatility: { max: 0.1 },
  },
} as const;

export type DebaterRating = {
  /** The stored state, before any idle-time widening. */
  readonly state: Glicko2State;
  /** When this debater was last rated on this format and ladder, if ever. */
  readonly lastRatedAt: string | null;
};

type RatedSide = {
  readonly before: Glicko2State;
  readonly after: Glicko2State;
};

export type RatedDebate = {
  readonly calculationVersion: string;
  readonly affirmative: RatedSide;
  readonly negative: RatedSide;
};

const { bounds } = ratingPolicy;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

function assertBounded(state: Glicko2State): void {
  const { rating, deviation, volatility } = state;
  const inside =
    Number.isFinite(rating) &&
    Number.isFinite(deviation) &&
    Number.isFinite(volatility) &&
    rating >= bounds.rating.min &&
    rating <= bounds.rating.max &&
    deviation >= bounds.deviation.min &&
    deviation <= bounds.deviation.max &&
    volatility > 0 &&
    volatility <= bounds.volatility.max;
  if (!inside)
    throw createInvariantError(
      debateInvariantIds.ratingStateBounded,
      'A stored rating state is outside the ledger bounds',
    );
}

const UTC_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;

/**
 * Milliseconds since the epoch of a UTC ISO 8601 instant, at any fractional
 * precision. Rate only against zoned UTC values at the precision of the rating ledger.
 */
function instant(timestamp: string): number {
  const ms = UTC_INSTANT.test(timestamp) ? tryInstantMs(timestamp) : undefined;
  if (ms === undefined)
    throw createAppError(
      'VALIDATION',
      'A rating timestamp is not UTC ISO 8601',
    );
  return ms;
}

/**
 * The deviation widened for the days since the last rating:
 * φ* = √(φ² + t·σ²), capped at the initial deviation. Pure in `at`.
 */
export function inflateDeviation(
  state: Glicko2State,
  lastRatedAt: string | null,
  at: string,
): Glicko2State {
  if (lastRatedAt === null) return state;
  const idle = Math.max(0, instant(at) - instant(lastRatedAt));
  if (idle === 0) return state;
  const periods = idle / ratingPolicy.inactivityPeriodMs;
  const phi = state.deviation / GLICKO2_SCALE;
  const widened =
    Math.sqrt(phi * phi + periods * state.volatility * state.volatility) *
    GLICKO2_SCALE;
  return {
    ...state,
    deviation: Math.min(widened, ratingPolicy.initial.deviation),
  };
}

/**
 * When a rated debate is posted to the ledger: at its completion, unless a
 * debater was already posted at or after it (another debate rated first, or
 * a delayed retry). Then it is posted one millisecond after that debater's
 * latest posting, so each debater's ledger stays strictly ordered and a late
 * debate is still rated rather than lost.
 */
export function postingInstant(
  completedAt: string,
  lastRatedAts: readonly (string | null)[],
): string {
  const completed = instant(completedAt);
  const latest = Math.max(
    ...lastRatedAts.map((at) => (at === null ? -Infinity : instant(at))),
  );
  return latest < completed ? completedAt : new Date(latest + 1).toISOString();
}

/** A previous season's state as it starts the next one. */
export function carryOver(previous: Glicko2State): Glicko2State {
  return {
    ...previous,
    deviation: clamp(
      previous.deviation,
      ratingPolicy.seasonDeviationFloor,
      ratingPolicy.initial.deviation,
    ),
  };
}

export function isProvisional(deviation: number): boolean {
  return deviation > ratingPolicy.provisionalDeviation;
}

const toBounds = (state: Glicko2State): Glicko2State => ({
  rating: clamp(state.rating, bounds.rating.min, bounds.rating.max),
  deviation: clamp(state.deviation, bounds.deviation.min, bounds.deviation.max),
  volatility: Math.min(state.volatility, bounds.volatility.max),
});

const scores: Readonly<
  Record<
    TwoSideKey,
    { affirmative: Glicko2Game['score']; negative: Glicko2Game['score'] }
  >
> = {
  [affirmativeSide]: { affirmative: 1, negative: 0 },
  [negativeSide]: { affirmative: 0, negative: 1 },
};

/** The winning side of a two-sided Round, the only one a rating compares. */
const twoSidedWinner = (outcome: WinnerOutcome): TwoSideKey => {
  if (outcome.side === affirmativeSide || outcome.side === negativeSide)
    return outcome.side;
  throw createAppError('CONFLICT', 'A rated debate is two-sided');
};

const meanState = (side: readonly Glicko2State[]): Glicko2State => {
  const mean = (key: keyof Glicko2State) =>
    side.reduce((sum, state) => sum + state[key], 0) / side.length;
  return {
    rating: mean('rating'),
    deviation: mean('deviation'),
    volatility: mean('volatility'),
  };
};

/** One rating period against the opposing side's mean widened pre-game state. */
export function rateDebateSides(input: {
  readonly affirmative: readonly DebaterRating[];
  readonly negative: readonly DebaterRating[];
  readonly outcome: WinnerOutcome;
  readonly occurredAt: string;
}) {
  const { affirmative, negative, occurredAt } = input;
  if (affirmative.length === 0 || negative.length === 0)
    throw createAppError('CONFLICT', 'A rated debate needs two occupied sides');
  const outcome = twoSidedWinner(input.outcome);
  // Validate the posting time even when every participant is a newcomer.
  instant(occurredAt);
  const widen = (side: readonly DebaterRating[]) =>
    side.map(({ state, lastRatedAt }) => {
      assertBounded(state);
      return inflateDeviation(state, lastRatedAt, occurredAt);
    });
  const affirmativeNow = widen(affirmative);
  const negativeNow = widen(negative);
  const rate = (
    side: readonly DebaterRating[],
    widened: readonly Glicko2State[],
    opponents: readonly Glicko2State[],
    score: Glicko2Game['score'],
  ): RatedSide[] => {
    const opponent = meanState(opponents);
    return side.map(({ state }, index) => ({
      before: state,
      after: toBounds(
        ratePeriod(widened[index]!, [{ opponent, score }], ratingPolicy),
      ),
    }));
  };
  return {
    calculationVersion: RATING_CALCULATION_VERSION,
    affirmative: rate(
      affirmative,
      affirmativeNow,
      negativeNow,
      scores[outcome].affirmative,
    ),
    negative: rate(
      negative,
      negativeNow,
      affirmativeNow,
      scores[outcome].negative,
    ),
  };
}

/** The head-to-head case of the shared two-sided rating period. */
export function rateDebate(input: {
  readonly affirmative: DebaterRating;
  readonly negative: DebaterRating;
  readonly outcome: WinnerOutcome;
  readonly occurredAt: string;
}): RatedDebate {
  const rated = rateDebateSides({
    ...input,
    affirmative: [input.affirmative],
    negative: [input.negative],
  });
  return {
    calculationVersion: rated.calculationVersion,
    affirmative: rated.affirmative[0]!,
    negative: rated.negative[0]!,
  };
}
