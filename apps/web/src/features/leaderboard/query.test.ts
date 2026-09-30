import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  activeFilterCount,
  clearFiltersHref,
  closeDetailHref,
  debaterHref,
  defaultQuery,
  isFiltered,
  ladderHref,
  pageHref,
  parseLadderQuery,
  scopeHref,
} from './query';

setupRitewayBun();

describe('parseLadderQuery', () => {
  test('missing parameters', () => {
    assert({
      given: 'no search parameters',
      should: 'return the defaults',
      actual: parseLadderQuery({}),
      expected: defaultQuery,
    });
  });

  test('valid parameters', () => {
    assert({
      given: 'every parameter set to a valid value',
      should: 'parse each one',
      actual: parseLadderQuery({
        season: '3',
        scope: 'around',
        q: '  @Debater-A ',
        status: 'everyone',
        band: 'bloom',
        region: 'europe',
        page: '4',
        debater: 'debater-a',
        view: 'table',
        step: '7',
      }),
      expected: {
        season: 3,
        scope: 'around',
        q: '@Debater-A',
        status: 'everyone',
        band: 'bloom',
        region: 'europe',
        page: 4,
        debater: 'debater-a',
        view: 'table',
        step: 7,
      },
    });
  });

  test('invalid values', () => {
    assert({
      given: 'values outside every allowed set',
      should: 'fall back to the defaults without throwing',
      actual: parseLadderQuery({
        season: '-1',
        scope: 'nope',
        status: '%00',
        band: 'gold',
        region: 'mars',
        page: '0x10',
        debater: '../etc',
        view: 'pie',
        step: 'x',
      }),
      expected: defaultQuery,
    });
  });

  test('page floor and repeated values', () => {
    assert({
      given: 'page 0 and a repeated parameter',
      should: 'floor the page at 1 and read the first value',
      actual: [
        parseLadderQuery({ page: '0' }).page,
        parseLadderQuery({ scope: ['around', 'top'] }).scope,
      ],
      expected: [1, 'around'],
    });
  });

  test('long search', () => {
    assert({
      given: 'a search longer than the limit',
      should: 'cut it to 40 characters',
      actual: parseLadderQuery({ q: 'x'.repeat(200) }).q.length,
      expected: 40,
    });
  });
});

describe('hrefs', () => {
  test('ladderHref carries only non-defaults', () => {
    assert({
      given: 'the default query and one with filters',
      should: 'link the bare path, then only what differs',
      actual: [
        ladderHref(defaultQuery),
        ladderHref({ ...defaultQuery, season: 3, status: 'everyone', page: 2 }),
      ],
      expected: [
        '/leaderboard',
        '/leaderboard?season=3&status=everyone&page=2',
      ],
    });
  });

  test('filters', () => {
    const query = {
      ...defaultQuery,
      season: 3,
      q: 'abc',
      status: 'everyone',
      band: 'bud',
      page: 2,
    } as const;
    assert({
      given: 'a filtered query',
      should: 'count, detect and clear the filters but keep the season',
      actual: [
        isFiltered(query),
        isFiltered(defaultQuery),
        activeFilterCount(query),
        clearFiltersHref(query),
      ],
      expected: [true, false, 2, '/leaderboard?season=3'],
    });
  });

  test('detail, page and scope links', () => {
    const query = {
      ...defaultQuery,
      season: 3,
      view: 'table',
      step: 4,
    } as const;
    assert({
      given: 'a query with a chart step on the table view',
      should:
        'open a debater on the chart, close the detail, turn the page and switch scope',
      actual: [
        debaterHref(query, 'debater-b'),
        closeDetailHref({ ...query, debater: 'debater-b' }),
        pageHref({ ...query, debater: 'debater-b' }, 3),
        scopeHref({ ...query, page: 5 }, 'around'),
      ],
      expected: [
        '/leaderboard?season=3&debater=debater-b',
        '/leaderboard?season=3',
        '/leaderboard?season=3&page=3',
        '/leaderboard?season=3&scope=around&view=table&step=4',
      ],
    });
  });
});
