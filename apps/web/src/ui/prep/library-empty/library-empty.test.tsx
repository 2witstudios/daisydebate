import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { defaultLibraryQuery } from '../../../features/prep/library-query';
import { FiltersHideEverything, NoResults } from './library-empty';

setupRitewayBun();

describe('NoResults', () => {
  test('titles mode and text mode', () => {
    const titles = renderToString(
      h(NoResults, { query: { ...defaultLibraryQuery, q: 'abc' } }),
    );
    const text = renderToString(
      h(NoResults, { query: { ...defaultLibraryQuery, q: 'abc', in: 'text' } }),
    );
    assert({
      given: 'a miss in titles mode and again in full-text mode',
      should: 'offer the full-text search only the first time',
      actual: [
        titles.includes('Search full text'),
        text.includes('Search full text'),
        text.includes('Nothing in the full text matches either'),
      ],
      expected: [true, false, true],
    });
  });
});

describe('FiltersHideEverything', () => {
  test('one match and a bare filter', () => {
    const html = renderToString(
      h(FiltersHideEverything, {
        query: { ...defaultLibraryQuery, tag: 'x' },
        searchMatches: 1,
      }),
    );
    assert({
      given: 'a tag filter with no search and one item in the library',
      should: 'speak of the library rather than a search, singular',
      actual: [
        html.includes('1 item in your library, but none match your filters.'),
        html.includes('href="/prep"'),
      ],
      expected: [true, true],
    });
  });
});
