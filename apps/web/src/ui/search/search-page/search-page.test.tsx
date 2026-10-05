import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { SearchPage } from './search-page';

setupRitewayBun();

const groups = [
  {
    kind: 'person' as const,
    items: [
      {
        kind: 'person' as const,
        label: 'maya',
        detail: 'Rated 1810',
        href: '/profile/maya',
      },
    ],
  },
];

describe('SearchPage', () => {
  test('results link to their pages', () => {
    const html = renderToString(
      h(SearchPage, { query: 'maya', groups, total: 1 }),
    );
    assert({
      given: 'one person hit',
      should: 'link the name to the profile and count it',
      actual: [
        html.includes('href="/profile/maya"'),
        html.includes('1 result for'),
      ],
      expected: [true, true],
    });
  });

  test('no hits', () => {
    const html = renderToString(
      h(SearchPage, { query: 'zzz', groups: [], total: 0 }),
    );
    assert({
      given: 'a query with no hits',
      should: 'say nothing matches',
      actual: html.includes('Nothing matches'),
      expected: true,
    });
  });

  test('no query', () => {
    const html = renderToString(
      h(SearchPage, { query: '', groups: [], total: 0 }),
    );
    assert({
      given: 'no query',
      should: 'offer a search form and no result summary',
      actual: [html.includes('result'), html.includes('action="/search"')],
      expected: [false, true],
    });
  });
});
