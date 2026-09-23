import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { LiveNow } from './live-now';
import { createInitialState } from '../../store/state';
import { UiStoreProvider } from '../../store/store';

setupRitewayBun();

const seed = createInitialState();

describe('LiveNow', () => {
  test('renders each live debate as a link into the watch route', () => {
    const initialState = {
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
    };
    const html = renderToString(
      h(UiStoreProvider, { initialState, children: h(LiveNow) }),
    );
    assert({
      given: 'a store with one live debate',
      should:
        'render the see-all link plus one /watch debate link with topic, both sides, ratings, viewers',
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
      expected: [2, true, true, true, true, true, true, true],
    });
  });

  test('names the see-all action for assistive technology', () => {
    const html = renderToString(
      h(UiStoreProvider, { initialState: seed, children: h(LiveNow) }),
    );
    assert({
      given: 'the live now panel',
      should: 'link "See All" to /watch with a disambiguating name',
      actual: [
        /<a [^>]*aria-label="See all live debates"[^>]*href="\/watch"/.test(
          html,
        ),
      ],
      expected: [true],
    });
  });
});
