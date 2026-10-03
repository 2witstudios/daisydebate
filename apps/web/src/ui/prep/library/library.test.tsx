import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  defaultLibraryQuery,
  type LibraryQuery,
} from '../../../features/prep/library-query';
import { listLibrary } from '../../../features/prep/list-library';
import { Library } from './library';

setupRitewayBun();

const now = '2026-09-30T12:00:00.000Z';
const render = (over: Partial<LibraryQuery>) => {
  const query = { ...defaultLibraryQuery, ...over };
  return renderToString(
    h(Library, { listing: listLibrary(query, now), query }),
  );
};

describe('Library', () => {
  test('the default page', () => {
    const html = render({});
    assert({
      given: 'the default library',
      should:
        'have one h1, the three header actions, tabs with counts, the toolbar inside the one list card, and no side column or jump-back strip',
      actual: [
        html.match(/<h1 /g)?.length,
        /href="\/prep\/cards\/new\?src=file"[^>]*>.*Import source/.test(html),
        /href="\/prep\/briefs\/new"[^>]*>.*New brief/.test(html),
        /href="\/prep\/cards\/new"[^>]*>.*Add evidence/.test(html),
        html.includes('href="/prep?view=cards"'),
        html.indexOf('aria-label="Your library"') <
          html.indexOf('aria-label="Search your library"'),
        html.includes('Jump back in'),
        html.includes('Saved searches'),
        html.includes('aria-label="Library"'),
      ],
      expected: [1, true, true, true, true, true, false, true, false],
    });
  });

  test('the search form is a GET to /prep', () => {
    const html = render({ view: 'cards', tag: 'costs' });
    assert({
      given: 'a cards view filtered by a tag',
      should:
        'post the form as GET to /prep, keep the view, and say how many it found',
      actual: [
        /<form [^>]*action="\/prep"[^>]*method="get"|<form [^>]*method="get"[^>]*action="\/prep"/.test(
          html,
        ),
        html.includes('name="view" value="cards"'),
        html.includes('<option value="costs" selected=""'),
        html.includes('Jump back in'),
        html.includes('1 card'),
      ],
      expected: [true, true, true, false, true],
    });
  });

  test('a search with nothing found', () => {
    const html = render({ q: 'zzz' });
    assert({
      given: 'a search nothing matches',
      should: 'say so and offer the full-text search',
      actual: [
        html.includes('No results for “zzz”'),
        html.includes('href="/prep?q=zzz&amp;in=text"'),
      ],
      expected: [true, true],
    });
  });

  test('filters that hide everything', () => {
    const html = render({ q: 'rights', side: 'neg', tag: 'rights' });
    assert({
      given: 'a search whose matches the filters all exclude',
      should: 'say so, offer a removable chip per filter and Clear filters',
      actual: [
        html.includes('none match your filters'),
        html.includes('aria-label="Remove Side: Neg"'),
        html.includes('aria-label="Remove Tag: rights"'),
        html.includes('Clear filters'),
      ],
      expected: [true, true, true, true],
    });
  });
});
