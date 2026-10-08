import { createInvariantError } from '@daisy/errors';
import { debateInvariantIds } from './invariant-ids';

/**
 * The Glicko-2 rating system as Glickman specifies it ("Example of the
 * Glicko-2 system", 2012), steps 2 to 8, on the familiar 1500 scale. Pure:
 * Daisy's own rules (one debate per period, inactivity, bounds) live in
 * `rating.ts`.
 */

export type Glicko2State = {
  readonly rating: number;
  readonly deviation: number;
  readonly volatility: number;
};

export type Glicko2Game = {
  readonly opponent: Pick<Glicko2State, 'rating' | 'deviation'>;
  /** 1 for a win, 0.5 for a draw, 0 for a loss. */
  readonly score: 0 | 0.5 | 1;
};

export type Glicko2Config = {
  /** The system constant: how far volatility may move in one period. */
  readonly tau: number;
  /** The convergence tolerance of the volatility search. */
  readonly epsilon: number;
  /** Search steps allowed before the calculation is refused. */
  readonly maxIterations: number;
};

/** Converts between the 1500 scale and Glicko-2's internal scale. */
export const GLICKO2_SCALE = 173.7178;

const finitePositive = (value: number) => Number.isFinite(value) && value > 0;

function assertRateable(
  player: Glicko2State,
  games: readonly Glicko2Game[],
): void {
  const valid =
    Number.isFinite(player.rating) &&
    finitePositive(player.deviation) &&
    finitePositive(player.volatility) &&
    games.every(
      ({ opponent }) =>
        Number.isFinite(opponent.rating) && finitePositive(opponent.deviation),
    );
  if (!valid)
    throw createInvariantError(
      debateInvariantIds.ratingStateBounded,
      'A rating state must be finite with a positive deviation and volatility',
    );
}

const g = (phi: number) => 1 / Math.sqrt(1 + (3 * phi * phi) / Math.PI ** 2);

const expectedScore = (mu: number, muJ: number, phiJ: number) =>
  1 / (1 + Math.exp(-g(phiJ) * (mu - muJ)));

/** Step 5: the new volatility by the Illinois method. */
function nextVolatility(
  phi: number,
  sigma: number,
  v: number,
  delta: number,
  { tau, epsilon, maxIterations }: Glicko2Config,
): number {
  const a = Math.log(sigma * sigma);
  const f = (x: number) => {
    const ex = Math.exp(x);
    const denominator = phi * phi + v + ex;
    return (
      (ex * (delta * delta - phi * phi - v - ex)) /
        (2 * denominator * denominator) -
      (x - a) / (tau * tau)
    );
  };
  let iterations = 0;
  const step = () => {
    iterations += 1;
    if (iterations > maxIterations)
      throw createInvariantError(
        debateInvariantIds.ratingVolatilityConverges,
        'The volatility search did not converge',
      );
  };

  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) {
      step();
      k += 1;
    }
    B = a - k * tau;
  }
  let fA = f(A);
  let fB = f(B);
  while (Math.abs(B - A) > epsilon) {
    step();
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
  }
  return Math.exp(A / 2);
}

/**
 * One rating period for one player: every game in `games` is rated against
 * the opponent's state at the start of the period. With no games, only the
 * deviation grows.
 */
export function ratePeriod(
  player: Glicko2State,
  games: readonly Glicko2Game[],
  config: Glicko2Config,
): Glicko2State {
  assertRateable(player, games);
  const mu = (player.rating - 1500) / GLICKO2_SCALE;
  const phi = player.deviation / GLICKO2_SCALE;
  const sigma = player.volatility;

  if (games.length === 0)
    return {
      rating: player.rating,
      deviation: Math.sqrt(phi * phi + sigma * sigma) * GLICKO2_SCALE,
      volatility: sigma,
    };

  const scaled = games.map(({ opponent, score }) => {
    const muJ = (opponent.rating - 1500) / GLICKO2_SCALE;
    const phiJ = opponent.deviation / GLICKO2_SCALE;
    return { gJ: g(phiJ), e: expectedScore(mu, muJ, phiJ), score };
  });
  const v =
    1 / scaled.reduce((sum, { gJ, e }) => sum + gJ * gJ * e * (1 - e), 0);
  const improvement = scaled.reduce(
    (sum, { gJ, e, score }) => sum + gJ * (score - e),
    0,
  );
  const delta = v * improvement;

  const sigmaPrime = nextVolatility(phi, sigma, v, delta, config);
  const phiStar = Math.sqrt(phi * phi + sigmaPrime * sigmaPrime);
  const phiPrime = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muPrime = mu + phiPrime * phiPrime * improvement;

  return {
    rating: muPrime * GLICKO2_SCALE + 1500,
    deviation: phiPrime * GLICKO2_SCALE,
    volatility: sigmaPrime,
  };
}
