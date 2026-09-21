import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { LiveNow } from './live-now';
import { createInitialState } from '../../store/state';
import { setUiState } from '../../store/store';

setupRitewayBun();

const seed = createInitialState();

describe('LiveNow', () => {
  test('renders each live debate as a link into the watch route', () => {
    setUiState({
      ...seed,
      collections: {
        ...seed.collections,
        liveDebates: [
          {
            topic: 'Tests Are Specifications',
            viewers: 77,
            challenger: 'Ada Byron',
            challengerRating: 2100,
            defender: 'Alan Kay',
            defenderRating: 1999,
          },
        ],
      },
    });
    const html = renderToString(h(LiveNow));
    assert({
      given: 'a store with one live debate',
      should: 'render one /watch link with topic, both sides, ratings, viewers',
      actual: [
        html.split('<a ').length - 1,
        html.includes('href="/watch"'),
        html.includes('Tests Are Specifications'),
        html.includes('Ada Byron'),
        html.includes('2100'),
        html.includes('Alan Kay'),
        html.includes('1999'),
        html.includes('>77<'),
      ],
      expected: [1, true, true, true, true, true, true, true],
    });
  });

  test('names the see-all action for assistive technology', () => {
    setUiState(seed);
    const html = renderToString(h(LiveNow));
    assert({
      given: 'the live now panel',
      should: 'disambiguate its "See All" button',
      actual: html.includes('aria-label="See all live debates"'),
      expected: true,
    });
  });
});
