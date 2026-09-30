import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { Segmented } from './segmented';

setupRitewayBun();

describe('Segmented', () => {
  test('links with one current', () => {
    const html = renderToString(
      h(Segmented, {
        label: 'Scope',
        segments: [
          { label: 'Top', href: '/leaderboard', selected: true },
          {
            label: 'Around me',
            href: '/leaderboard?scope=around',
            selected: false,
          },
        ],
      }),
    );
    assert({
      given: 'two segments, the first current',
      should: 'render a labelled nav of links marking only the first current',
      actual: [
        html.includes('aria-label="Scope"'),
        html.match(/<a /g)?.length,
        html.match(/aria-current="page"/g)?.length,
        html.includes('href="/leaderboard?scope=around"'),
      ],
      expected: [true, 2, 1, true],
    });
  });
});
