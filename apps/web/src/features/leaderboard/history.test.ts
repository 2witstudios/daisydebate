import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  chartGeometry,
  lastStep,
  linePath,
  linearScale,
  peakRating,
  readoutAt,
  resultRows,
  signed,
  type RatingPoint,
} from './history';

setupRitewayBun();

const point = (
  game: number,
  rating: number,
  deviation: number,
  result: RatingPoint['result'] = game === 0 ? null : 'won',
): RatingPoint => ({
  game,
  rating,
  deviation,
  result,
  opponent: game === 0 ? null : `rival-${game}`,
});

const points = [
  point(0, 1500, 350),
  point(1, 1520, 200),
  point(2, 1490, 100, 'lost'),
  point(3, 1540, 50),
];

describe('linearScale', () => {
  test('maps a domain onto a range', () => {
    const scale = linearScale([0, 10], [100, 0]);
    assert({
      given: 'a descending range (screen y)',
      should: 'map the ends and the middle',
      actual: [scale(0), scale(5), scale(10), scale(20)],
      expected: [100, 50, 0, -100],
    });
  });

  test('a flat domain', () => {
    assert({
      given: 'a domain of one value',
      should: 'map everything to the start of the range',
      actual: linearScale([5, 5], [7, 9])(5),
      expected: 7,
    });
  });
});

describe('linePath', () => {
  test('path', () => {
    assert({
      given: 'three coordinates',
      should: 'move then line, rounded to a tenth',
      actual: linePath([
        [0, 0],
        [10.04, 20.06],
        [30, 5],
      ]),
      expected: 'M0 0L10 20.1L30 5',
    });
  });
});

describe('chartGeometry', () => {
  const chart = chartGeometry(points, 2);

  test('axes', () => {
    assert({
      given: 'ratings 1490 to 1540',
      should: 'start the axis near the lowest rating, in steps of a third',
      actual: [
        chart.yTicks.map((tick) => tick.label),
        chart.xTicks.map((tick) => tick.label),
      ],
      expected: [
        ['1450', '1500', '1550', '1600'],
        ['0', '2', '3'],
      ],
    });
  });

  test('line and dots', () => {
    assert({
      given: 'four points',
      should: 'put the first at the left margin and the last at the right',
      actual: [
        chart.line.startsWith('M40 '),
        chart.dots[0]?.x,
        chart.dots.at(-1)?.x,
        chart.dots.length,
        chart.plot,
        chart.viewBox,
      ],
      expected: [
        true,
        40,
        406,
        4,
        { left: 40, right: 406, top: 12, bottom: 164 },
        '0 0 420 190',
      ],
    });
  });

  test('band stays inside the plot', () => {
    const numbers = chart.band.match(/-?\d+(\.\d+)?/g)?.map(Number) ?? [];
    const ys = numbers.filter((_, i) => i % 2 === 1);
    assert({
      given: 'a wide early deviation of 350 (a ±700 range)',
      should: 'clamp the shaded band to the plot and close the path',
      actual: [
        Math.min(...ys) >= 12,
        Math.max(...ys) <= 164,
        chart.band.endsWith('Z'),
      ],
      expected: [true, true, true],
    });
  });

  test('established marker', () => {
    assert({
      given: 'a rating established at game 2, and one never established',
      should: 'place the dashed rule at that game, or none',
      actual: [chart.establishedX, chartGeometry(points, null).establishedX],
      expected: [284, null],
    });
  });
});

describe('readoutAt', () => {
  test('steps', () => {
    assert({
      given: 'the start, a win, a loss and no step',
      should: 'read each debate, and the latest by default',
      actual: [
        readoutAt(points, 0),
        readoutAt(points, 2),
        readoutAt(points, null).heading,
        readoutAt(points, 99).heading,
      ],
      expected: [
        {
          heading: 'Season start',
          value: '1500 ± 700',
          detail: 'Starting rating',
        },
        {
          heading: 'Debate 2 of 3',
          value: '1490 ± 200',
          detail: 'Lost vs @rival-2 (−30)',
        },
        'Debate 3 of 3',
        'Debate 3 of 3',
      ],
    });
  });
});

describe('results', () => {
  test('rows newest first', () => {
    assert({
      given: 'three ranked debates',
      should: 'list them newest first with signed changes',
      actual: resultRows(points).map((row) => [row.game, row.change, row.up]),
      expected: [
        [3, '+50', true],
        [2, '−30', false],
        [1, '+20', true],
      ],
    });
  });

  test('peak and last step', () => {
    assert({
      given: 'the series',
      should: 'find the highest rating after a debate and the last step',
      actual: [peakRating(points), lastStep(points), signed(0)],
      expected: [1540, 3, '0'],
    });
  });
});
