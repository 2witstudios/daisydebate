import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  activeFilterCount,
  clearFiltersHref,
  defaultQuery,
  isFiltered,
  parseTournamentsQuery,
  tournamentsHref,
} from './query';

setupRitewayBun();

describe('parseTournamentsQuery', () => {
  test('missing and valid parameters', () => {
    assert({
      given: 'no parameters, then every parameter valid',
      should: 'return the defaults, then each parsed value',
      actual: [
        parseTournamentsQuery({}),
        parseTournamentsQuery({
          tab: 'past',
          q: '  Cup ',
          structure: 'round-robin',
          rules: 'custom',
        }),
      ],
      expected: [
        defaultQuery,
        { tab: 'past', q: 'Cup', structure: 'round-robin', rules: 'custom' },
      ],
    });
  });

  test('bad, repeated and oversized parameters', () => {
    assert({
      given: 'unknown values, an array and a 200-character search',
      should: 'fall back per field, take the first repeat and cap the search',
      actual: [
        parseTournamentsQuery({
          tab: 'nope',
          structure: 'chess',
          rules: '%00',
        }),
        parseTournamentsQuery({ tab: ['live', 'past'] }).tab,
        parseTournamentsQuery({ q: 'x'.repeat(200) }).q.length,
      ],
      expected: [defaultQuery, 'live', 80],
    });
  });
});

describe('tournamentsHref', () => {
  test('only non-default values are carried', () => {
    assert({
      given: 'the default, a tab, and a filtered query',
      should: 'build the shortest URL',
      actual: [
        tournamentsHref(defaultQuery),
        tournamentsHref({ ...defaultQuery, tab: 'live' }),
        tournamentsHref({
          ...defaultQuery,
          structure: 'round-robin',
          rules: 'standard',
        }),
      ],
      expected: [
        '/tournaments',
        '/tournaments?tab=live',
        '/tournaments?structure=round-robin&rules=standard',
      ],
    });
  });
});

describe('filter state', () => {
  const query = {
    ...defaultQuery,
    tab: 'live' as const,
    q: 'cup',
    rules: 'custom' as const,
  };

  test('clear keeps the tab; counts and flags read the filters', () => {
    assert({
      given: 'a live-tab query with a search and a rules filter',
      should:
        'clear to the tab only, flag it filtered and count the panel filters',
      actual: [
        clearFiltersHref(query),
        isFiltered(query),
        isFiltered({ ...defaultQuery, tab: 'past' }),
        activeFilterCount(query),
      ],
      expected: ['/tournaments?tab=live', true, false, 1],
    });
  });
});
