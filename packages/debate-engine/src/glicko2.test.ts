import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { ratePeriod, type Glicko2Game, type Glicko2State } from './glicko2';

setupRitewayBun();

const config = { tau: 0.5, epsilon: 1e-6, maxIterations: 100 };

/** Glickman's worked example ("Example of the Glicko-2 system", 2012). */
const examplePlayer: Glicko2State = {
  rating: 1500,
  deviation: 200,
  volatility: 0.06,
};
const exampleGames: readonly Glicko2Game[] = [
  { opponent: { rating: 1400, deviation: 30 }, score: 1 },
  { opponent: { rating: 1550, deviation: 100 }, score: 0 },
  { opponent: { rating: 1700, deviation: 300 }, score: 0 },
];

const rounded = ({ rating, deviation, volatility }: Glicko2State) => ({
  rating: rating.toFixed(2),
  deviation: deviation.toFixed(2),
  volatility: volatility.toFixed(6),
});

const fresh: Glicko2State = { rating: 1500, deviation: 350, volatility: 0.06 };

describe('ratePeriod', () => {
  test('matches the published reference example', () => {
    // The paper prints 1464.06 / 151.52 / 0.05999 from rounded intermediate
    // values (mu' = -0.2069) and a truncated volatility; carried at full
    // precision the same steps give 1464.0507 / 151.5165 / 0.0599960.
    assert({
      given: "Glickman's example player and three games",
      should: 'produce the reference rating, deviation and volatility',
      actual: rounded(ratePeriod(examplePlayer, exampleGames, config)),
      expected: {
        rating: '1464.05',
        deviation: '151.52',
        volatility: '0.059996',
      },
    });
  });

  test('widens only the deviation when no game is played', () => {
    const after = ratePeriod(examplePlayer, [], config);
    assert({
      given: 'a rating period with no games',
      should: 'keep the rating and volatility',
      actual: [after.rating, after.volatility],
      expected: [1500, 0.06],
    });
    assert({
      given: 'a rating period with no games',
      should: 'widen the deviation by one period of volatility',
      actual: after.deviation.toFixed(4),
      expected: (
        173.7178 * Math.sqrt((200 / 173.7178) ** 2 + 0.06 ** 2)
      ).toFixed(4),
    });
  });

  test('moves equal players symmetrically', () => {
    const opponent = { rating: 1500, deviation: 350 };
    const win = ratePeriod(fresh, [{ opponent, score: 1 }], config);
    const loss = ratePeriod(fresh, [{ opponent, score: 0 }], config);
    const draw = ratePeriod(fresh, [{ opponent, score: 0.5 }], config);
    assert({
      given: 'a win against an equal opponent',
      should: 'raise the rating and narrow the deviation',
      actual: win.rating > 1500 && win.deviation < 350,
      expected: true,
    });
    assert({
      given: 'the matching loss',
      should: 'mirror the win around the starting rating',
      actual: (win.rating - 1500 - (1500 - loss.rating)).toFixed(9),
      expected: '0.000000000',
    });
    assert({
      given: 'a draw between equal players',
      should: 'leave the rating unchanged',
      actual: Math.abs(draw.rating - 1500) < 1e-9,
      expected: true,
    });
  });

  test('converges on both volatility search branches', () => {
    const upset = ratePeriod(
      { rating: 1200, deviation: 60, volatility: 0.06 },
      [{ opponent: { rating: 2200, deviation: 40 }, score: 1 }],
      config,
    );
    const routine = ratePeriod(
      { rating: 1500, deviation: 60, volatility: 0.06 },
      [{ opponent: { rating: 1500, deviation: 60 }, score: 0.5 }],
      config,
    );
    assert({
      given: 'an upset that pushes the volatility up',
      should: 'converge to a higher volatility',
      actual: upset.volatility > 0.06,
      expected: true,
    });
    assert({
      given: 'an expected result that lowers the volatility',
      should: 'converge to a lower volatility',
      actual: routine.volatility < 0.06,
      expected: true,
    });
  });

  test('rejects a rating state outside the ledger bounds', async () => {
    for (const [given, player] of [
      ['a zero deviation', { ...fresh, deviation: 0 }],
      ['a NaN rating', { ...fresh, rating: Number.NaN }],
      ['an infinite volatility', { ...fresh, volatility: Infinity }],
    ] as const)
      await assertRejects({
        given,
        should: 'refuse with debate.rating.state-bounded',
        actual: () => ratePeriod(player, exampleGames, config),
        code: 'INVARIANT',
        invariantId: 'debate.rating.state-bounded',
      });
    await assertRejects({
      given: 'an opponent with a negative deviation',
      should: 'refuse with debate.rating.state-bounded',
      actual: () =>
        ratePeriod(
          fresh,
          [{ opponent: { rating: 1500, deviation: -1 }, score: 1 }],
          config,
        ),
      code: 'INVARIANT',
      invariantId: 'debate.rating.state-bounded',
    });
  });

  test('rejects a volatility iteration that does not converge', async () => {
    await assertRejects({
      given: 'an iteration budget too small to converge',
      should: 'refuse with debate.rating.volatility-converges',
      actual: () =>
        ratePeriod(examplePlayer, exampleGames, {
          ...config,
          maxIterations: 1,
        }),
      code: 'INVARIANT',
      invariantId: 'debate.rating.volatility-converges',
    });
  });
});
