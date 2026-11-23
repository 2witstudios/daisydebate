import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { chartGeometry } from '../features/leaderboard/history';
import { renderMarkup } from '../test-support/rendered/markup';
import { renderRatingChart } from '../ui/leaderboard/rating-chart/rating-chart.render';

setupRitewayBun();

const points = [
  { game: 0, rating: 1500, deviation: 350, result: null, opponent: null },
  { game: 1, rating: 1520, deviation: 200, result: 'won', opponent: 'x' },
  { game: 2, rating: 1490, deviation: 100, result: 'lost', opponent: 'y' },
] as const;

const render = (established: number | null) =>
  renderMarkup(
    renderRatingChart({
      chart: chartGeometry(points, established),
      label: 'Rating history, Season 4.',
      step: 2,
      lastStep: 2,
      readout: {
        heading: 'Debate 2 of 2',
        value: '1490 ± 200',
        detail: 'Lost vs @y (−30)',
      },
      interactive: false,
      onStep: () => undefined,
      onPointer: () => undefined,
    }),
  );

/**
 * The established rule is a dashed line inside the chart's SVG image, which
 * has no role or name of its own; only the markup shows whether it is drawn.
 */
describe('renderRatingChart markup', () => {
  test('the established rule', () => {
    assert({
      given: 'a rating not yet established, and one established at debate 1',
      should: 'draw the dashed rule only once established',
      actual: [render(null), render(1)].map((html) =>
        html.includes('stroke-dasharray'),
      ),
      expected: [false, true],
    });
  });
});
