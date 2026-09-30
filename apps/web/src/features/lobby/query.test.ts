import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  activeFilterCount,
  clearFiltersHref,
  defaultQuery,
  isFiltered,
  lobbyHref,
  parseLobbyQuery,
} from './query';

setupRitewayBun();

describe('parseLobbyQuery', () => {
  test('missing parameters', () => {
    assert({
      given: 'no search parameters',
      should: 'return the defaults',
      actual: parseLobbyQuery({}),
      expected: defaultQuery,
    });
  });

  test('valid parameters', () => {
    assert({
      given: 'every parameter set to a valid value',
      should: 'parse each one',
      actual: parseLobbyQuery({
        tab: 'open',
        mode: 'ranked',
        q: '  @Host  ',
        format: 'public-forum',
        range: '200',
        sort: 'waiting',
      }),
      expected: {
        tab: 'open',
        mode: 'ranked',
        q: '@Host',
        format: 'public-forum',
        range: 200,
        sort: 'waiting',
      },
    });
  });

  test('invalid values', () => {
    assert({
      given: 'values outside every allowed set',
      should: 'fall back to the defaults without throwing',
      actual: parseLobbyQuery({
        tab: 'closed',
        mode: 'RANKED',
        format: 'chess',
        range: '250',
        sort: 'random',
      }),
      expected: defaultQuery,
    });
  });

  test('repeated and non-string values', () => {
    assert({
      given: 'a repeated parameter',
      should: 'use its first value',
      actual: parseLobbyQuery({ tab: ['live', 'open'], range: ['100', '300'] }),
      expected: { ...defaultQuery, tab: 'live', range: 100 },
    });
  });

  test('an oversized search', () => {
    assert({
      given: 'a search of 500 characters',
      should: 'cap it at 80',
      actual: parseLobbyQuery({ q: 'x'.repeat(500) }).q.length,
      expected: 80,
    });
  });

  test('prototype-named parameters', () => {
    assert({
      given: 'a parameter named after an Object.prototype member',
      should: 'ignore it',
      actual: parseLobbyQuery({ tab: 'constructor', sort: '__proto__' }),
      expected: defaultQuery,
    });
  });
});

describe('lobbyHref', () => {
  test('the default query', () => {
    assert({
      given: 'the default query',
      should: 'link to the bare lobby',
      actual: lobbyHref(defaultQuery),
      expected: '/lobby',
    });
  });

  test('a filtered query', () => {
    assert({
      given: 'a query with non-default values',
      should: 'carry only those, in a stable order, encoded',
      actual: lobbyHref({
        ...defaultQuery,
        tab: 'open',
        q: 'a b&c',
        range: 100,
        sort: 'high',
      }),
      expected: '/lobby?tab=open&q=a+b%26c&range=100&sort=high',
    });
  });

  test('round trip', () => {
    const query = {
      tab: 'live',
      mode: 'casual',
      q: 'spar',
      format: 'parliamentary',
      range: 300,
      sort: 'watched',
    } as const;
    const params = Object.fromEntries(
      new URL(lobbyHref(query), 'https://x.test').searchParams,
    );
    assert({
      given: 'a href built from a query',
      should: 'parse back to the same query',
      actual: parseLobbyQuery(params),
      expected: query,
    });
  });
});

describe('filter state', () => {
  test('clearing keeps the tab and sort', () => {
    assert({
      given: 'a filtered query on the live tab sorted by rating',
      should: 'clear the filters but keep tab and sort',
      actual: clearFiltersHref({
        tab: 'live',
        mode: 'ranked',
        q: 'x',
        format: 'public-forum',
        range: 100,
        sort: 'high',
      }),
      expected: '/lobby?tab=live&sort=high',
    });
  });

  test('isFiltered ignores tab and sort', () => {
    assert({
      given: 'a query that only changes tab and sort',
      should: 'not count as filtered',
      actual: [
        isFiltered({ ...defaultQuery, tab: 'live', sort: 'low' }),
        isFiltered({ ...defaultQuery, q: 'x' }),
        isFiltered({ ...defaultQuery, range: 100 }),
      ],
      expected: [false, true, true],
    });
  });

  test('the phone badge counts mode, format and range, not search', () => {
    assert({
      given: 'queries with different filters set',
      should: 'count the panel filters only',
      actual: [
        activeFilterCount(defaultQuery),
        activeFilterCount({ ...defaultQuery, q: 'x' }),
        activeFilterCount({
          ...defaultQuery,
          mode: 'ranked',
          format: 'public-forum',
          range: 200,
        }),
      ],
      expected: [0, 0, 3],
    });
  });
});
