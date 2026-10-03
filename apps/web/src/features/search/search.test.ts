import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  groupHits,
  parseSearchQuery,
  searchItems,
  type SearchItem,
} from './search';

setupRitewayBun();

const items: readonly SearchItem[] = [
  {
    kind: 'room',
    label: 'Tuesday night',
    detail: 'Hosted by host-one',
    href: '/rooms/a',
  },
  {
    kind: 'person',
    label: 'maya',
    detail: 'Rated 1810',
    href: '/profile/maya',
  },
  {
    kind: 'person',
    label: 'daniel',
    detail: 'Rated 1762',
    href: '/profile/daniel',
  },
];

describe('parseSearchQuery', () => {
  test('trims the query', () => {
    assert({
      given: 'a query with surrounding space',
      should: 'return it trimmed',
      actual: parseSearchQuery({ q: '  maya ' }),
      expected: 'maya',
    });
  });

  test('absent or oversized', () => {
    assert({
      given: 'no query and a very long one',
      should: 'give an empty query and a bounded one',
      actual: [
        parseSearchQuery({}),
        parseSearchQuery({ q: 'x'.repeat(500) }).length,
      ],
      expected: ['', 80],
    });
  });

  test('repeated parameter', () => {
    assert({
      given: 'q given twice',
      should: 'use the first',
      actual: parseSearchQuery({ q: ['one', 'two'] }),
      expected: 'one',
    });
  });
});

describe('searchItems', () => {
  test('matches label or detail, any case', () => {
    assert({
      given: 'a query that names a detail',
      should: 'find the item case-insensitively',
      actual: searchItems('HOST-ONE', items).map((item) => item.label),
      expected: ['Tuesday night'],
    });
  });

  test('every word must match', () => {
    assert({
      given: 'two words, only one of which matches',
      should: 'find nothing',
      actual: searchItems('maya tuesday', items),
      expected: [],
    });
  });

  test('empty query', () => {
    assert({
      given: 'an empty query',
      should: 'find nothing rather than everything',
      actual: searchItems('  ', items),
      expected: [],
    });
  });
});

describe('groupHits', () => {
  test('fixed order, no empty groups', () => {
    assert({
      given: 'a room and two people',
      should: 'list people before rooms and skip other kinds',
      actual: groupHits(items).map((group) => [group.kind, group.items.length]),
      expected: [
        ['person', 2],
        ['room', 1],
      ],
    });
  });
});
