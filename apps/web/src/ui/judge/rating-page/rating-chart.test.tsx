import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { RatingChart } from './rating-chart';

setupRitewayBun();

describe('RatingChart', () => {
  test('a rising trend', () => {
    const html = renderToString(h(RatingChart, { series: [10, 20, 30] }));
    assert({
      given: 'three ratings',
      should: 'draw one polyline with a labelled image role and an end dot',
      actual: [
        html.includes('role="img"'),
        html.includes('aria-label="Your rating over recent ballots"'),
        html.split('<polyline').length - 1,
        html.split('<circle').length - 1,
      ],
      expected: [true, true, 1, 1],
    });
  });
});
