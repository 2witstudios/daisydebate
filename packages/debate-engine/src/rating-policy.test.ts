import { assertRejects } from '@daisy/errors/testing';
import { debateModes } from '@daisy/protocol';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  carryOver,
  inflateDeviation,
  isProvisional,
  ladderForMode,
  RATING_CALCULATION_VERSION,
} from './rating';

setupRitewayBun();

const at = '2026-10-05T12:00:00.000Z';
const daysBefore = (days: number) =>
  new Date(Date.parse(at) - days * 86_400_000).toISOString();

describe('inflateDeviation', () => {
  const state = { rating: 1500, deviation: 60, volatility: 0.06 };

  test('reads only UTC ISO instants', async () => {
    const day = (at: string) =>
      inflateDeviation(state, '2026-10-04T12:00:00.000Z', at).deviation;
    assert({
      given: 'UTC instants without and with extra fractional precision',
      should: 'read them as the same instant',
      actual: [day('2026-10-05T12:00:00Z'), day('2026-10-05T12:00:00.000123Z')],
      expected: [
        day('2026-10-05T12:00:00.000Z'),
        day('2026-10-05T12:00:00.000Z'),
      ],
    });
    for (const at of [
      '2026-10-05T12:00:00',
      '2026-10-05T14:00:00+02:00',
      '2026-02-30T12:00:00Z',
    ])
      await assertRejects({
        given: `the instant ${at}`,
        should: 'refuse it as not a UTC ISO instant',
        actual: () => day(at),
        code: 'VALIDATION',
      });
  });

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
      actual: debateModes.map(ladderForMode),
      expected: [null, 'ranked', 'quick', null],
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
