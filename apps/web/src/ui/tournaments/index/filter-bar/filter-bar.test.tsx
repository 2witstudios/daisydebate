import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  defaultQuery,
  type TournamentsQuery,
} from '../../../../features/tournaments/query';
import { FilterBar } from './filter-bar';

setupRitewayBun();

const counts = { open: 4, upcoming: 4, live: 2, past: 2 };
const render = (query: TournamentsQuery, resultCount = 4) =>
  renderToString(h(FilterBar, { query, counts, resultCount }));

describe('FilterBar form contract', () => {
  test('a real GET form to the index with no client-only submit', () => {
    const html = render(defaultQuery);
    assert({
      given: 'the default query',
      should:
        'be a GET form to the index, with a search role and a submit Apply',
      actual: [
        html.match(/<form [^>]*>/)?.[0],
        /<button type="submit"[^>]*>Apply<\/button>/.test(html),
        html.includes('onChange'),
      ].flat(),
      expected: [
        '<form role="search" aria-label="Filter tournaments" class="flex flex-wrap items-center gap-x-3 gap-y-4" action="/tournaments" method="get">',
        true,
        false,
      ],
    });
  });

  test('every URL parameter has a named control', () => {
    const names = [
      ...render(defaultQuery).matchAll(/<(?:input|select) [^>]*name="(\w+)"/g),
    ]
      .map((match) => match[1])
      .sort();
    assert({
      given: 'the default query',
      should: 'name tab, q, structure and rules',
      actual: names,
      expected: ['q', 'rules', 'structure', 'tab'],
    });
  });

  test('tabs are links with counts that keep the filters', () => {
    const html = render({ ...defaultQuery, structure: 'round-robin' });
    assert({
      given: 'a round-robin filter on the open tab',
      should: 'link In progress with the filter kept and mark open current',
      actual: [
        html.includes('href="/tournaments?tab=live&amp;structure=round-robin"'),
        html.match(/aria-current="page"/g)?.length,
        /In progress<span[^>]*>2</.test(html),
      ],
      expected: [true, 1, true],
    });
  });

  test('Clear shows only when filtered, and the phone badge counts filters', () => {
    const plain = render(defaultQuery);
    const filtered = render({
      ...defaultQuery,
      tab: 'live',
      structure: 'round-robin',
      rules: 'standard',
    });
    assert({
      given: 'an unfiltered and a two-filter query',
      should: 'show Clear and the count 2 only when filtered',
      actual: [
        plain.includes('>Clear<'),
        filtered.includes('href="/tournaments?tab=live"'),
        filtered.includes('>2</span>'),
      ],
      expected: [false, true, true],
    });
  });
});
