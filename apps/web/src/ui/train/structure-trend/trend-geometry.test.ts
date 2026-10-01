import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { areaPath, linePath, trendPoints } from './trend-geometry';

setupRitewayBun();

describe('trend geometry', () => {
  test('points', () => {
    assert({
      given: 'values of 0, 50 and 100',
      should: 'span the plot from the baseline to the top',
      actual: trendPoints([0, 50, 100]),
      expected: [
        { x: 40, y: 162 },
        { x: 220, y: 88 },
        { x: 400, y: 14 },
      ],
    });
  });

  test('values outside 0 to 100 are clamped', () => {
    assert({
      given: 'values of -10 and 120',
      should: 'stay on the plot',
      actual: trendPoints([-10, 120]).map((p) => p.y),
      expected: [162, 14],
    });
  });

  test('a single value', () => {
    assert({
      given: 'one value',
      should: 'sit at the right edge',
      actual: trendPoints([50]),
      expected: [{ x: 400, y: 88 }],
    });
  });

  test('paths', () => {
    const points = trendPoints([0, 100]);
    assert({
      given: 'two points',
      should: 'draw a line and close the area to the baseline',
      actual: [linePath(points), areaPath(points), areaPath([])],
      expected: ['M40 162 L400 14', 'M40 162 L400 14 L400 162 L40 162 Z', ''],
    });
  });
});
