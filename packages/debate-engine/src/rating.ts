import { createAppError, createInvariantError } from '@daisy/errors';
import type { DebateMode, RatingLadder } from '@daisy/protocol';
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

export type RatedOutcome = 'affirmative' | 'negative' | 'draw';

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

const UTC_INSTANT = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})(?:\.(\d+))?Z$/;

/**
 * Milliseconds since the epoch of a UTC ISO 8601 instant, at any fractional
 * precision. Anything else is refused: `Date.parse` reads an offset-free
 * time in the host's zone and rolls an impossible date into the next month,
 * either of which would make a rating depend on the machine computing it.
 */
function instant(timestamp: string): number {
  const match = UTC_INSTANT.exec(timestamp);
  const fraction = (match?.[2] ?? '').slice(0, 3).padEnd(3, '0');
  const canonical = match ? `${match[1]}.${fraction}Z` : '';
  const ms = Date.parse(canonical);
  if (Number.isNaN(ms) || new Date(ms).toISOString() !== canonical)
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

/** The ladder a debate mode rates on, or null when the mode never rates. */
export function ladderForMode(mode: DebateMode): RatingLadder | null {
  return mode === 'ranked' || mode === 'quick' ? mode : null;
}

const toBounds = (state: Glicko2State): Glicko2State => ({
  rating: clamp(state.rating, bounds.rating.min, bounds.rating.max),
  deviation: clamp(state.deviation, bounds.deviation.min, bounds.deviation.max),
  volatility: Math.min(state.volatility, bounds.volatility.max),
});

const scores: Readonly<
  Record<
    RatedOutcome,
    { affirmative: Glicko2Game['score']; negative: Glicko2Game['score'] }
  >
> = {
  affirmative: { affirmative: 1, negative: 0 },
  negative: { affirmative: 0, negative: 1 },
  draw: { affirmative: 0.5, negative: 0.5 },
};

/**
 * Rates one decided debate as one period for each side. Both sides are
 * widened for idle time to `occurredAt`, then each is rated against the
 * other's widened state from before this debate, never against its result.
 * `before` is each side's stored state, so a ledger chain within a season
 * reads `before(n) == after(n - 1)`.
 */
export function rateDebate(input: {
  readonly affirmative: DebaterRating;
  readonly negative: DebaterRating;
  readonly outcome: RatedOutcome;
  readonly occurredAt: string;
}): RatedDebate {
  const { affirmative, negative, outcome, occurredAt } = input;
  // Validated here, not only while widening: two newcomers never widen.
  instant(occurredAt);
  assertBounded(affirmative.state);
  assertBounded(negative.state);
  const affirmativeNow = inflateDeviation(
    affirmative.state,
    affirmative.lastRatedAt,
    occurredAt,
  );
  const negativeNow = inflateDeviation(
    negative.state,
    negative.lastRatedAt,
    occurredAt,
  );
  const rate = (
    player: Glicko2State,
    opponent: Glicko2State,
    score: Glicko2Game['score'],
  ) => toBounds(ratePeriod(player, [{ opponent, score }], ratingPolicy));
  return {
    calculationVersion: RATING_CALCULATION_VERSION,
    affirmative: {
      before: affirmative.state,
      after: rate(affirmativeNow, negativeNow, scores[outcome].affirmative),
    },
    negative: {
      before: negative.state,
      after: rate(negativeNow, affirmativeNow, scores[outcome].negative),
    },
  };
}
