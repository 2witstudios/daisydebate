import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { describeRating, ratingNote, seasonLine } from './standing';

setupRitewayBun();

describe('describeRating', () => {
  test('each rating state', () => {
    assert({
      given: 'provisional, established and unrated ratings',
      should: 'show the figure and a status for each',
      actual: [
        describeRating({ kind: 'provisional', value: 1412 }),
        describeRating({ kind: 'established', value: 1586 }),
        describeRating({ kind: 'unrated' }),
      ],
      expected: [
        { kind: 'provisional', figure: '1412', status: 'Provisional' },
        { kind: 'established', figure: '1586', status: 'Established' },
        { kind: 'unrated', figure: 'Unrated', status: 'Unrated' },
      ],
    });
  });
});

describe('seasonLine', () => {
  test('plural and singular days', () => {
    assert({
      given: 'a season with 41 days and one with 1 day left',
      should: 'pluralise days',
      actual: [
        seasonLine({ number: 3, daysLeft: 41 }),
        seasonLine({ number: 3, daysLeft: 1 }),
      ],
      expected: ['Season 3 · 41 days left', 'Season 3 · 1 day left'],
    });
  });
});

describe('ratingNote', () => {
  test('only unrated players get a note', () => {
    assert({
      given: 'each rating state',
      should: 'explain how an unrated player gets a rating, and nothing else',
      actual: [
        ratingNote({ kind: 'unrated' }),
        ratingNote({ kind: 'provisional', value: 1400 }),
        ratingNote({ kind: 'established', value: 1400 }),
      ],
      expected: ['Your first ranked debate sets your rating.', null, null],
    });
  });
});
