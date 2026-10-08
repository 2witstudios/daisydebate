import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { emptyKind, resultsLine } from './library-labels';
import { defaultLibraryQuery } from './library-query';

setupRitewayBun();

const q = (over: Partial<typeof defaultLibraryQuery>) => ({
  ...defaultLibraryQuery,
  ...over,
});

describe('resultsLine', () => {
  test('all and kind tabs', () => {
    assert({
      given: 'counts on All (two sorts) and on the cards tab',
      should: 'pluralise and name the order only on All',
      actual: [
        resultsLine(q({}), 11),
        resultsLine(q({ sort: 'title' }), 1),
        resultsLine(q({ view: 'cards' }), 5),
        resultsLine(q({ view: 'cases' }), 1),
      ],
      expected: [
        '11 items, newest first',
        '1 item, by title',
        '5 cards',
        '1 case',
      ],
    });
  });
});

describe('emptyKind', () => {
  test('the three reasons', () => {
    assert({
      given: 'a search with no matches, filters hiding matches, and a bare tab',
      should: 'tell them apart',
      actual: [
        emptyKind(q({ q: 'zzz' }), 0),
        emptyKind(q({ q: 'rights', side: 'neg' }), 3),
        emptyKind(q({ tag: 'rights' }), 4),
        emptyKind(q({ view: 'cases' }), 0),
      ],
      expected: ['no-results', 'filters-hide', 'filters-hide', 'none-in-view'],
    });
  });
});
