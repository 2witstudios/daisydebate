import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  activeFilterCount,
  clearFiltersHref,
  clearSearchHref,
  defaultLibraryQuery,
  filterChips,
  hasFilters,
  libraryHref,
  MAX_FIELD_LENGTH,
  parseLibraryQuery,
} from './library-query';

setupRitewayBun();

describe('parseLibraryQuery', () => {
  test('no parameters', () => {
    assert({
      given: 'an empty query string',
      should: 'give the defaults',
      actual: parseLibraryQuery({}),
      expected: defaultLibraryQuery,
    });
  });

  test('every field', () => {
    assert({
      given: 'a full set of valid parameters',
      should: 'read each one',
      actual: parseLibraryQuery({
        view: 'cards',
        q: ' costs ',
        tag: 'rights',
        side: 'neg',
        motion: '[Motion A]',
        source: '[Journal]',
        in: 'text',
        sort: 'used',
      }),
      expected: {
        view: 'cards',
        q: 'costs',
        tag: 'rights',
        side: 'neg',
        motion: '[Motion A]',
        source: '[Journal]',
        in: 'text',
        sort: 'used',
      },
    });
  });

  test('bad values', () => {
    assert({
      given: 'unknown enum values and a repeated parameter',
      should: 'fall back to defaults and take the first repeat',
      actual: parseLibraryQuery({
        view: 'decks',
        side: 'both',
        sort: '\u0000',
        in: 'everything',
        tag: ['a', 'b'],
      }),
      expected: { ...defaultLibraryQuery, tag: 'a' },
    });
  });

  test('over-long text', () => {
    assert({
      given: 'a search longer than the limit',
      should: 'cut it to the limit',
      actual: parseLibraryQuery({ q: 'x'.repeat(500) }).q.length,
      expected: MAX_FIELD_LENGTH,
    });
  });
});

describe('libraryHref', () => {
  test('defaults and non-defaults', () => {
    assert({
      given: 'the default query and one with a view and a tag',
      should: 'omit defaults from the URL',
      actual: [
        libraryHref(defaultLibraryQuery),
        libraryHref({ ...defaultLibraryQuery, view: 'cards', tag: 'costs' }),
      ],
      expected: ['/prep', '/prep?view=cards&tag=costs'],
    });
  });
});

describe('filters', () => {
  const filtered = {
    ...defaultLibraryQuery,
    view: 'briefs' as const,
    q: 'a',
    side: 'aff' as const,
    tag: 'rights',
  };

  test('clear, detect and count', () => {
    assert({
      given: 'a query with a side and a tag filter',
      should:
        'count two, report filtered, and clear filters but keep view and search',
      actual: [
        activeFilterCount(filtered),
        hasFilters(filtered),
        hasFilters(defaultLibraryQuery),
        clearFiltersHref(filtered),
        clearSearchHref(filtered),
      ],
      expected: [2, true, false, '/prep?view=briefs&q=a', '/prep?view=briefs'],
    });
  });

  test('chips', () => {
    assert({
      given: 'a side and a tag filter',
      should: 'make one removable chip each that keeps the other',
      actual: filterChips(filtered),
      expected: [
        { label: 'Side: Aff', removeHref: '/prep?view=briefs&q=a&tag=rights' },
        { label: 'Tag: rights', removeHref: '/prep?view=briefs&q=a&side=aff' },
      ],
    });
  });
});
