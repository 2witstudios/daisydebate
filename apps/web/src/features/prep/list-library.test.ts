import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { listLibrary } from './list-library';
import { defaultLibraryQuery, type LibraryQuery } from './library-query';

setupRitewayBun();

const now = '2026-09-30T12:00:00.000Z';
const run = (over: Partial<LibraryQuery>) =>
  listLibrary({ ...defaultLibraryQuery, ...over }, now);
const titles = (over: Partial<LibraryQuery>) =>
  run(over).rows.map((row) => row.title);

describe('listLibrary', () => {
  test('the default listing', () => {
    const listing = run({});
    assert({
      given: 'the default query',
      should:
        'list every item, newest edit first, with tab counts and jump-back cards',
      actual: [
        listing.rows.length,
        listing.total,
        listing.counts,
        listing.rows[0]?.title,
        listing.jumpBackIn.map((row) => row.title),
      ],
      expected: [
        11,
        11,
        { all: 11, briefs: 4, cards: 5, cases: 2 },
        'Affirmative case: rights-based framework',
        [
          'Affirmative case: rights-based framework',
          'Cost estimates depend on assumed take-up',
          'Affirmative, rights-based',
        ],
      ],
    });
  });

  test('a view tab', () => {
    assert({
      given: 'the cases tab',
      should: 'list only cases but keep counts for every tab',
      actual: [titles({ view: 'cases' }), run({ view: 'cases' }).counts.all],
      expected: [['Affirmative, rights-based', 'Negative, costs first'], 11],
    });
  });

  test('search and filters narrow counts and hide jump-back', () => {
    const listing = run({ tag: 'costs' });
    assert({
      given: 'the costs tag',
      should: 'count matches per tab and drop the jump-back cards',
      actual: [listing.counts, listing.jumpBackIn.length],
      expected: [{ all: 3, briefs: 1, cards: 1, cases: 1 }, 0],
    });
  });

  test('side, motion and source filters', () => {
    assert({
      given: 'side neg, then a source',
      should: 'keep briefs and cases of that side; sources keep only cards',
      actual: [
        titles({ side: 'neg', sort: 'title' }),
        titles({ source: '[Journal]', sort: 'title' }),
      ],
      expected: [
        [
          'Negative block: implementation costs',
          'Negative, costs first',
          'Opening statements, [Motion B]',
        ],
        [
          'Pilot results do not transfer across regions',
          'Rights claims survive changes in policy',
        ],
      ],
    });
  });

  test('full-text search reads passages', () => {
    assert({
      given: 'a word only a passage holds',
      should: 'find nothing in titles mode and the card in text mode',
      actual: [titles({ q: 'lapse' }), titles({ q: 'lapse', in: 'text' })],
      expected: [[], ['Rights claims survive changes in policy']],
    });
  });

  test('sorts', () => {
    assert({
      given: 'title and most-used sorts',
      should: 'order by title, and by uses with title breaking ties',
      actual: [
        titles({ sort: 'title' })[0],
        titles({ sort: 'used' }).slice(0, 2),
      ],
      expected: [
        'Affirmative case: rights-based framework',
        [
          'Cost estimates depend on assumed take-up',
          'Affirmative case: rights-based framework',
        ],
      ],
    });
  });

  test('filters that hide a search', () => {
    const listing = run({ q: 'rights', side: 'neg', tag: 'rights' });
    assert({
      given: 'a search with results that the filters then exclude',
      should: 'list nothing but say how many the search alone found',
      actual: [listing.rows.length, listing.searchMatches > 0],
      expected: [0, true],
    });
  });

  test('saved searches run their filters', () => {
    assert({
      given: 'the sample saved searches',
      should: 'link to the library with their filters and count the matches',
      actual: run({}).savedSearches.map((saved) => [saved.href, saved.count]),
      expected: [
        ['/prep?tag=costs&motion=%5BMotion+A%5D', 2],
        ['/prep?tag=rights', 4],
        ['/prep?tag=framework&side=aff', 1],
      ],
    });
  });
});
