import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  carryOver,
  inflateDeviation,
  isProvisional,
  ladderForMode,
  RATING_CALCULATION_VERSION,
  rateDebate,
  ratingPolicy,
  type DebaterRating,
} from './rating';

setupRitewayBun();

const at = '2026-10-05T12:00:00.000Z';
const daysBefore = (days: number) =>
  new Date(Date.parse(at) - days * 86_400_000).toISOString();

const newcomer: DebaterRating = {
  state: ratingPolicy.initial,
  lastRatedAt: null,
};

const settled = (
  rating: number,
  deviation: number,
  volatility = 0.06,
): DebaterRating => ({
  state: { rating, deviation, volatility },
  lastRatedAt: at,
});

describe('rateDebate', () => {
  test('rates a decided debate between newcomers symmetrically', () => {
    const result = rateDebate({
      affirmative: newcomer,
      negative: newcomer,
      outcome: 'affirmative',
      occurredAt: at,
    });
    assert({
      given: 'two newcomers and an affirmative win',
      should: 'stamp the calculation version',
      actual: result.calculationVersion,
      expected: 'glicko2-v1',
    });
    assert({
      given: 'two newcomers and an affirmative win',
      should: 'move both ratings by the same amount in opposite directions',
      actual: (
        result.affirmative.after.rating -
        1500 -
        (1500 - result.negative.after.rating)
      ).toFixed(9),
      expected: '0.000000000',
    });
    assert({
      given: 'two newcomers and an affirmative win',
      should: 'raise the winner',
      actual: result.affirmative.after.rating > 1500,
      expected: true,
    });
    assert({
      given: 'two newcomers',
      should: 'record each side before the debate as its stored state',
      actual: [result.affirmative.before, result.negative.before],
      expected: [ratingPolicy.initial, ratingPolicy.initial],
    });
  });

  test('mirrors a negative win and holds a draw between equals', () => {
    const negativeWin = rateDebate({
      affirmative: newcomer,
      negative: newcomer,
      outcome: 'negative',
      occurredAt: at,
    });
    const draw = rateDebate({
      affirmative: newcomer,
      negative: newcomer,
      outcome: 'draw',
      occurredAt: at,
    });
    assert({
      given: 'a negative win',
      should: 'raise the negative and lower the affirmative',
      actual: [
        negativeWin.negative.after.rating > 1500,
        negativeWin.affirmative.after.rating < 1500,
      ],
      expected: [true, true],
    });
    assert({
      given: 'a draw between equal newcomers',
      should: 'leave both ratings unchanged',
      actual: [
        Math.abs(draw.affirmative.after.rating - 1500) < 1e-9,
        Math.abs(draw.negative.after.rating - 1500) < 1e-9,
      ],
      expected: [true, true],
    });
  });

  test('rates each side against the other as it stood before the debate', () => {
    const strong = settled(1800, 60);
    const result = rateDebate({
      affirmative: strong,
      negative: newcomer,
      outcome: 'negative',
      occurredAt: at,
    });
    const winnerMove = result.negative.after.rating - 1500;
    const loserMove = 1800 - result.affirmative.after.rating;
    assert({
      given: 'a settled favourite losing to an uncertain newcomer',
      should: 'move the uncertain newcomer further than the settled favourite',
      actual: winnerMove > loserMove && loserMove > 0,
      expected: true,
    });
  });

  test('widens an idle deviation before rating', () => {
    const idle = rateDebate({
      affirmative: { ...settled(1600, 60), lastRatedAt: daysBefore(365) },
      negative: settled(1600, 60),
      outcome: 'affirmative',
      occurredAt: at,
    });
    const active = rateDebate({
      affirmative: settled(1600, 60),
      negative: settled(1600, 60),
      outcome: 'affirmative',
      occurredAt: at,
    });
    assert({
      given: 'a debater idle for a year',
      should: 'move further on a win than one who played today',
      actual: idle.affirmative.after.rating > active.affirmative.after.rating,
      expected: true,
    });
    assert({
      given: 'a debater idle for a year',
      should: 'still record the stored state before the debate',
      actual: idle.affirmative.before.deviation,
      expected: 60,
    });
  });

  test('clamps results to the ledger bounds', () => {
    const top = rateDebate({
      affirmative: settled(3999, 350),
      negative: settled(3999, 350),
      outcome: 'affirmative',
      occurredAt: at,
    });
    const steady = rateDebate({
      affirmative: settled(1500, 30, 0.001),
      negative: settled(1500, 30, 0.001),
      outcome: 'draw',
      occurredAt: at,
    });
    assert({
      given: 'a win at the top of the rating band',
      should: 'clamp the rating to 4000',
      actual: top.affirmative.after.rating,
      expected: 4000,
    });
    assert({
      given: 'a draw between steady debaters at the deviation floor',
      should: 'keep the deviation at the floor of 30',
      actual: steady.affirmative.after.deviation,
      expected: 30,
    });
  });

  test('refuses a stored state outside the ledger bounds', async () => {
    for (const [given, state] of [
      [
        'a rating above 4000',
        { rating: 4001, deviation: 100, volatility: 0.06 },
      ],
      [
        'a deviation above 350',
        { rating: 1500, deviation: 351, volatility: 0.06 },
      ],
      [
        'a deviation below 30',
        { rating: 1500, deviation: 29, volatility: 0.06 },
      ],
      [
        'a volatility above 0.1',
        { rating: 1500, deviation: 100, volatility: 0.2 },
      ],
    ] as const)
      await assertRejects({
        given,
        should: 'refuse with debate.rating.state-bounded',
        actual: () =>
          rateDebate({
            affirmative: { state, lastRatedAt: null },
            negative: newcomer,
            outcome: 'draw',
            occurredAt: at,
          }),
        code: 'INVARIANT',
        invariantId: 'debate.rating.state-bounded',
      });
  });

  test('refuses an unparseable timestamp', async () => {
    for (const [given, affirmative] of [
      ['two newcomers', newcomer],
      ['a debater rated before', { ...newcomer, lastRatedAt: at }],
    ] as const)
      await assertRejects({
        given: `${given} and an occurredAt that is not an ISO timestamp`,
        should: 'refuse as a validation error before rating',
        actual: () =>
          rateDebate({
            affirmative,
            negative: newcomer,
            outcome: 'draw',
            occurredAt: 'yesterday',
          }),
        code: 'VALIDATION',
      });
  });
});

describe('inflateDeviation', () => {
  const state = { rating: 1500, deviation: 60, volatility: 0.06 };

  test('grows with idle time and caps at the initial deviation', () => {
    assert({
      given: 'no previous rating',
      should: 'leave the state unchanged',
      actual: inflateDeviation(state, null, at),
      expected: state,
    });
    assert({
      given: 'thirty idle days',
      should: 'widen the deviation by thirty periods of volatility',
      actual: inflateDeviation(state, daysBefore(30), at).deviation.toFixed(4),
      expected: (
        173.7178 * Math.sqrt((60 / 173.7178) ** 2 + 30 * 0.06 ** 2)
      ).toFixed(4),
    });
    assert({
      given: 'ten idle years',
      should: 'cap the deviation at 350',
      actual: inflateDeviation(state, daysBefore(3650), at).deviation,
      expected: 350,
    });
    assert({
      given: 'a last rating after the debate',
      should: 'treat the idle time as zero',
      actual: inflateDeviation(state, daysBefore(-5), at),
      expected: state,
    });
  });
});

describe('carryOver', () => {
  test('keeps the rating and volatility and widens the deviation', () => {
    assert({
      given: 'a settled deviation of 60 from last season',
      should: 'widen it to the season floor of 150',
      actual: carryOver({ rating: 1720, deviation: 60, volatility: 0.05 }),
      expected: { rating: 1720, deviation: 150, volatility: 0.05 },
    });
    assert({
      given: 'a deviation already above the season floor',
      should: 'keep it',
      actual: carryOver({ rating: 1420, deviation: 300, volatility: 0.07 }),
      expected: { rating: 1420, deviation: 300, volatility: 0.07 },
    });
  });
});

describe('isProvisional', () => {
  test('marks a deviation above 110 as provisional', () => {
    assert({
      given: 'deviations either side of 110',
      should: 'mark only the wider one provisional',
      actual: [isProvisional(110.01), isProvisional(110)],
      expected: [true, false],
    });
  });
});

describe('ladderForMode', () => {
  test('maps rated modes to their ladder and the rest to none', () => {
    assert({
      given: 'every debate mode',
      should: 'rate ranked and quick on their own ladders only',
      actual: ['ranked', 'quick', 'casual', 'practice'].map(ladderForMode),
      expected: ['ranked', 'quick', null, null],
    });
  });
});

describe('RATING_CALCULATION_VERSION', () => {
  test('names the first Daisy Glicko-2 calculation', () => {
    assert({
      given: 'the rating policy',
      should: 'be glicko2-v1',
      actual: RATING_CALCULATION_VERSION,
      expected: 'glicko2-v1',
    });
  });
});
