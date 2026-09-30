import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { chartGeometry } from '../../../features/leaderboard/history';
import {
  renderRatingChart,
  type RatingChartRenderProps,
} from './rating-chart.render';

setupRitewayBun();

const points = [
  { game: 0, rating: 1500, deviation: 350, result: null, opponent: null },
  { game: 1, rating: 1520, deviation: 200, result: 'won', opponent: 'x' },
  { game: 2, rating: 1490, deviation: 100, result: 'lost', opponent: 'y' },
] as const;

const props = (
  overrides: Partial<RatingChartRenderProps> = {},
): RatingChartRenderProps => ({
  chart: chartGeometry(points, null),
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
  ...overrides,
});

const html = (p: RatingChartRenderProps) =>
  renderToString(renderRatingChart(p)).replace(/<!-- -->/g, '');

describe('renderRatingChart', () => {
  test('static chart', () => {
    const out = html(props());
    assert({
      given: 'a chart with no script',
      should:
        'draw a labelled SVG, the readout, no slider and no established mark',
      actual: [
        out.includes('role="img"'),
        out.includes('aria-label="Rating history, Season 4."'),
        out.includes('1490 ± 200'),
        out.includes('Debate 2 of 2'),
        out.includes('type="range"'),
        out.includes('stroke-dasharray'),
        out.includes('Established'),
      ],
      expected: [true, true, true, true, false, false, false],
    });
  });

  test('interactive', () => {
    const out = html(props({ interactive: true, step: 1 }));
    assert({
      given: 'a chart once a script runs',
      should: 'add the slider, bounded to the last debate, at the current step',
      actual: [
        out.includes('type="range"'),
        out.includes('max="2"'),
        out.includes('value="1"'),
        out.includes('Step through debates'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('established', () => {
    const out = html(props({ chart: chartGeometry(points, 1) }));
    assert({
      given: 'a rating established at debate 1',
      should: 'draw the dashed rule and list it in the key',
      actual: [out.includes('stroke-dasharray'), out.includes('Established')],
      expected: [true, true],
    });
  });
});
