import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  clearFiltersHref,
  defaultLiveQuery,
  hubHref,
  isFiltered,
  parseLiveQuery,
} from './live-query';

setupRitewayBun();

describe('parseLiveQuery', () => {
  test('no parameters', () => {
    assert({
      given: 'an empty query',
      should: 'return the defaults',
      actual: parseLiveQuery({}),
      expected: defaultLiveQuery,
    });
  });

  test('valid parameters', () => {
    assert({
      given: 'every parameter set',
      should: 'read them',
      actual: parseLiveQuery({
        tab: 'following',
        mode: 'ranked',
        q: '  debater-a ',
        before: 'abcdefghijklmnopqrstuvwx',
      }),
      expected: {
        tab: 'following',
        mode: 'ranked',
        q: 'debater-a',
        before: 'abcdefghijklmnopqrstuvwx',
      },
    });
  });

  test('untrusted parameters', () => {
    assert({
      given: 'unknown values, an array and an overlong search',
      should: 'fall back to defaults and cap the search',
      actual: parseLiveQuery({
        tab: 'recordings',
        mode: ['casual', 'ranked'],
        before: '%00',
        q: 'x'.repeat(500),
      }),
      expected: { ...defaultLiveQuery, mode: 'casual', q: 'x'.repeat(80) },
    });
  });
});

describe('hub hrefs', () => {
  test('only non-default values are carried', () => {
    assert({
      given: 'queries with and without non-defaults',
      should: 'build the shortest URL',
      actual: [
        hubHref(defaultLiveQuery),
        hubHref({ ...defaultLiveQuery, mode: 'ranked', q: 'a b' }),
        hubHref({ ...defaultLiveQuery, tab: 'following' }),
      ],
      expected: ['/watch', '/watch?mode=ranked&q=a+b', '/watch?tab=following'],
    });
  });

  test('clearing filters keeps the tab and leaves the page', () => {
    const query = {
      ...defaultLiveQuery,
      tab: 'following',
      before: 'abcdefghijklmnopqrstuvwx',
      mode: 'casual',
    } as const;
    assert({
      given: 'a filtered later page on the following tab',
      should: 'drop only mode and search',
      actual: [
        clearFiltersHref(query),
        isFiltered(query),
        isFiltered({ ...defaultLiveQuery, tab: 'following' }),
      ],
      expected: ['/watch?tab=following', true, false],
    });
  });
});
