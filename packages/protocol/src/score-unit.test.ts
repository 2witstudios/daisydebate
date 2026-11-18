import { sumScoreValues } from './score-unit';
import { scoreScaleFor } from './score-unit';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  scoreUnitFor,
  scoreUnits,
  commonScoreUnit,
  convertScoreUnits,
  scoreLatticeValues,
  scoreLatticeSize,
  scoreValueAt,
} from './score-unit';
import { daisyWinnerBallot } from './ballot-definition';
setupRitewayBun();

test('a competitive score preserves the pinned definition unit exactly', () => {
  const points = daisyWinnerBallot.points!;
  const decimal = {
    ...points,
    per: 'speech' as const,
    scale: { min: 0, max: 10, step: 0.1 },
    weights: { reply: 0.25 },
  };
  const unit = scoreUnitFor(decimal);
  assert({
    given: 'decimal steps and a quarter-weight reply on the pinned definition',
    should: 'derive one exact rational unit without binary-float rounding',
    actual: [
      unit,
      unit && scoreUnits(0.3, unit),
      unit && scoreUnits(0.025, unit),
    ],
    expected: [
      { numerator: '1', denominator: '40' },
      { kind: 'exact', units: 12 },
      { kind: 'exact', units: 1 },
    ],
  });
});
test('unrepresentable scores never become invented or rounded engine points', () => {
  const unit = { numerator: '1', denominator: '10' };
  assert({
    given:
      'a fraction below the pinned unit, nonfinite score or unsafe integer count',
    should: 'refuse each instead of rounding, truncating or overflowing',
    actual: [
      scoreUnits(0.05, unit),
      scoreUnits(Number.NaN, unit),
      scoreUnits(Number.MAX_SAFE_INTEGER, unit),
      scoreUnits(1, { numerator: 'invalid', denominator: '0' }),
    ],
    expected: [
      { kind: 'unrepresentable' },
      { kind: 'unrepresentable' },
      { kind: 'unrepresentable' },
      { kind: 'unrepresentable' },
    ],
  });
});

test('a nonzero score lattice starts at the declared minimum', () => {
  const points = {
    ...daisyWinnerBallot.points!,
    scale: { min: 0.25, max: 1.25, step: 0.1 },
  };
  const unit = scoreUnitFor(points);
  assert({
    given: 'minimum 0.25 and step 0.1',
    should: 'represent every legal offset without rounding the minimum',
    actual: [unit, unit && scoreUnits(0.35, unit)],
    expected: [
      { numerator: '1', denominator: '20' },
      { kind: 'exact', units: 7 },
    ],
  });
});

test('mixed pinned units normalize without recomputing or rounding contributions', () => {
  const tenth = { numerator: '1', denominator: '10' };
  const quarter = { numerator: '1', denominator: '4' };
  const common = commonScoreUnit([tenth, quarter]);
  assert({
    given: 'immutable results on tenths and quarters',
    should: 'derive twentieths and convert integer contributions exactly',
    actual: [
      common,
      common && convertScoreUnits(3, tenth, common),
      common && convertScoreUnits(3, quarter, common),
      convertScoreUnits(1, tenth, quarter),
    ],
    expected: [
      { numerator: '1', denominator: '20' },
      { kind: 'exact', units: 6 },
      { kind: 'exact', units: 15 },
      { kind: 'unrepresentable' },
    ],
  });
});

test('score lattice enumeration is exact and bounded', () => {
  const scale = { min: 0.25, max: 0.56, step: 0.1 };
  assert({
    given: 'a fractional offset, weighted speech, and a huge legal lattice',
    should:
      'list only exact legal values and bound enumeration while permitting indexed anchors',
    actual: [
      scoreLatticeValues(scale),
      scoreLatticeValues(scale, 0.5),
      scoreLatticeValues({ min: 0, max: 1, step: 0.000000001 }),
      scoreLatticeSize({ min: 0, max: 1, step: 0.000000001 }),
      scoreValueAt({ min: 0, max: 1, step: 0.000000001 }, 500000000),
    ],
    expected: [
      [0.25, 0.35, 0.45, 0.55],
      [0.125, 0.175, 0.225, 0.275],
      null,
      1000000001,
      0.5,
    ],
  });
});

test('per-speech scales and defaults retain exact authored weights', () => {
  const points = {
    ...daisyWinnerBallot.points!,
    per: 'speech' as const,
    scale: { min: 0.25, max: 0.56, step: 0.1 },
    default: 0.35,
    weights: { reply: 0.5 },
  };
  assert({
    given:
      'a weighted reply and an unweighted speech on the same authored scale',
    should:
      'produce exact subject scales and explicit defaults without binary multiplication artefacts',
    actual: [scoreScaleFor(points, 'reply'), scoreScaleFor(points, 'opening')],
    expected: [
      { scale: { min: 0.125, max: 0.28, step: 0.05 }, default: 0.175 },
      { scale: { min: 0.25, max: 0.56, step: 0.1 }, default: 0.35 },
    ],
  });
});

test('decimal totals preserve exact ties across different criterion contributions', () => {
  assert({
    given: 'two equal authored totals with different decimal leaves',
    should:
      'sum before numeric conversion without a false low-point difference',
    actual: [
      sumScoreValues([0.1, 0.2]),
      sumScoreValues([0.3, 0]),
      sumScoreValues([0.175, 0.175, 0.175]),
    ],
    expected: [0.3, 0.3, 0.525],
  });
});
