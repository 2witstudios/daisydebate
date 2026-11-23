import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderMarkup } from '../test-support/rendered/markup';
import { SeasonsPage } from '../ui/leaderboard/seasons-page/seasons-page';

setupRitewayBun();

/**
 * With no season at all the page keeps its column frame and display title;
 * both are layout classes with no role, name or state.
 */
describe('SeasonsPage markup', () => {
  test('no active season', () => {
    const html = renderMarkup(h(SeasonsPage, { view: null }));
    assert({
      given: 'no active season',
      should: 'keep the page frame',
      actual: [
        html.includes('max-w-dash-column'),
        html.includes('font-display'),
      ],
      expected: [true, true],
    });
  });
});
