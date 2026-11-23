import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { chartGeometry } from '../../../features/leaderboard/history';
import {
  renderRatingChart,
  type RatingChartRenderProps,
} from './rating-chart.render';
import { renderAccessible } from '../../../test-support/rendered/accessible';

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

const render = (p: RatingChartRenderProps) =>
  renderAccessible(renderRatingChart(p));

/** The chart key's entries, in order. */
const key = (view: ReturnType<typeof render>) =>
  view.all('listitem').map((item) => item.textContent);

describe('renderRatingChart', () => {
  test('static chart', () => {
    const view = render(props());
    assert({
      given: 'a chart before hydration',
      should:
        'draw a labelled SVG, the readout, no slider and no established key',
      actual: [
        view.names('img'),
        view.textContent().includes('1490 ± 200'),
        view.textContent().includes('Debate 2 of 2'),
        view.count('slider'),
        key(view),
      ],
      expected: [
        ['Rating history, Season 4.'],
        true,
        true,
        0,
        ['Rating', '95% range'],
      ],
    });
  });

  test('interactive', () => {
    const view = render(props({ interactive: true, step: 1 }));
    assert({
      given: 'a chart once a script runs',
      should: 'add the slider, bounded to the last debate, at the current step',
      actual: [
        view.has('slider', 'Step through debates'),
        view.attribute('slider', 'Step through debates', 'max'),
        view.attribute('slider', 'Step through debates', 'value'),
      ],
      expected: [true, '2', '1'],
    });
  });

  test('established', () => {
    const view = render(props({ chart: chartGeometry(points, 1) }));
    assert({
      given: 'a rating established at debate 1',
      should: 'list it in the key',
      actual: key(view).includes('Established'),
      expected: true,
    });
  });
});
