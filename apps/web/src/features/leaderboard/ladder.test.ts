import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { PAGE_SIZE } from './ladder-view';
import { entry } from './standing.test-support';
import { closedSeason, field, ladder } from './ladder.test-support';

setupRitewayBun();

const names = (view: ReturnType<typeof ladder>) =>
  view.rows.map((row) => row.username);

describe('buildLadder pages', () => {
  const entries = field(40);

  test('first page has a podium and the next twelve rows', () => {
    const view = ladder(entries);
    assert({
      given: 'forty established debaters',
      should: 'show the top three as a podium, then rows up to a full page',
      actual: [
        view.podium.map((row) => row.rank),
        view.rows.length,
        view.rows[0]?.rank,
        view.pageCount,
        view.total,
      ],
      expected: [[1, 2, 3], PAGE_SIZE - 3, 4, 3, 40],
    });
  });

  test('later pages have no podium', () => {
    const view = ladder(entries, { page: 2 });
    assert({
      given: 'page two',
      should: 'list the next fifteen ranks',
      actual: [view.podium.length, view.rows[0]?.rank, view.rows.length],
      expected: [0, 16, PAGE_SIZE],
    });
  });

  test('page past the end', () => {
    assert({
      given: 'a page number beyond the last',
      should: 'show the last page',
      actual: ladder(entries, { page: 99 }).page,
      expected: 3,
    });
  });

  test('a filter hides the podium', () => {
    assert({
      given: 'a search on the first page',
      should: 'list matches as plain rows with no podium',
      actual: [
        ladder(entries, { q: 'p00' }).podium.length,
        names(ladder(entries, { q: '@P003' })),
      ],
      expected: [0, ['p003']],
    });
  });
});

describe('buildLadder filters', () => {
  const entries = [
    ...field(12),
    entry({ id: 'prov', username: 'prov', rating: 1800, played: 3 }),
    entry({ id: 'eu', username: 'eu', rating: 1000 }),
  ];

  test('status', () => {
    assert({
      given: 'established, provisional and everyone',
      should: 'include only those debaters',
      actual: (['established', 'provisional', 'everyone'] as const).map(
        (status) => ladder(entries, { status }).total,
      ),
      expected: [13, 1, 14],
    });
  });

  test('no tier on any row', () => {
    const view = ladder(entries, { status: 'everyone' });
    assert({
      given: 'established and provisional debaters',
      should: 'carry no bloom band on any row (debaters have no tiers)',
      actual: [...view.podium, ...view.rows].some((row) => 'bloom' in row),
      expected: false,
    });
  });

  test('provisional hits', () => {
    const view = ladder(entries, { q: 'prov' });
    assert({
      given: 'a search that matches only a provisional debater',
      should: 'say so instead of a dead end',
      actual: [view.empty, view.provisionalHits, view.total],
      expected: ['provisional-hits', 1, 0],
    });
  });

  test('no match', () => {
    assert({
      given: 'a search nobody matches',
      should: 'report a filtered empty table',
      actual: ladder(entries, { q: 'zzz' }).empty,
      expected: 'filtered',
    });
  });

  test('a deleted account is not searchable', () => {
    assert({
      given: 'a tombstone row and a search',
      should: 'not match it, but keep it in the ladder without a link',
      actual: [
        ladder([entry({ id: 'gone', username: null })], { q: 'gone' }).total,
        ladder([entry({ id: 'gone', username: null }), ...field(3)]).rows.find(
          (row) => row.username === null,
        )?.href,
      ],
      expected: [0, null],
    });
  });
});

describe('buildLadder rows', () => {
  test('movement follows the season state', () => {
    const entries = [entry({ id: 'a', weekChange: 3, seasonChange: -8 })];
    assert({
      given: 'a live season and a closed one',
      should: 'show the seven-day change, then the season change',
      actual: [
        ladder(entries).rows[0]?.change,
        ladder(entries, {}, null, closedSeason).rows[0]?.change,
      ],
      expected: [
        { kind: 'up', amount: 3 },
        { kind: 'down', amount: 8 },
      ],
    });
  });

  test('provisional rows have no movement or rank', () => {
    const [row] = ladder([entry({ id: 'p', played: 2, weekChange: 5 })], {
      status: 'everyone',
    }).rows;
    assert({
      given: 'a provisional debater',
      should: 'show no rank and no movement',
      actual: [row?.rank, row?.change, row?.provisional],
      expected: [null, { kind: 'none' }, true],
    });
  });

  test('selected row and link', () => {
    const view = ladder(field(12), { season: 5, debater: 'p005' });
    assert({
      given: 'the detail open on one debater',
      should: 'mark that row selected and link rows to their detail',
      actual: [
        view.podium.length,
        view.rows.findIndex((row) => row.selected),
        view.rows[0]?.href,
      ],
      expected: [3, 2, '/leaderboard?season=5&debater=p003'],
    });
  });
});

describe('judge blinding', () => {
  test('a judged debater is masked', () => {
    const view = ladder(
      field(12),
      {},
      { username: 'judge', blinded: ['p001', 'p003'] },
    );
    const masked = [...view.podium, ...view.rows].filter((row) => row.masked);
    assert({
      given: 'a masked row',
      should: 'carry none of the debater’s numbers',
      actual: masked.map((row) => [row.rating, row.range, row.wins]),
      expected: [
        [0, 0, 0],
        [0, 0, 0],
      ],
    });
    assert({
      given: 'a judge assigned to two debaters',
      should: 'hide their rank while every other row keeps its rank',
      actual: [
        masked.map((row) => [row.username, row.rank]),
        [...view.podium, ...view.rows].map((row) => row.rank),
      ],
      expected: [
        [
          ['p001', null],
          ['p003', null],
        ],
        [1, null, 3, null, 5, 6, 7, 8, 9, 10, 11, 12],
      ],
    });
  });
});

describe('seasons', () => {
  test('a new season with nobody ranked', () => {
    const view = ladder([entry({ id: 'p', played: 0 })]);
    assert({
      given: 'a live season where nobody is established',
      should: 'show the new-season empty state, not a search miss',
      actual: [view.empty, view.established, view.provisional],
      expected: ['new-season', 0, 1],
    });
  });

  test('an early season lists everyone', () => {
    const view = ladder([...field(3), entry({ id: 'p', played: 2 })]);
    assert({
      given: 'a live season with three established debaters',
      should: 'default to Everyone with no podium',
      actual: [view.early, view.status, view.total, view.podium.length],
      expected: [true, 'everyone', 4, 0],
    });
  });

  test('a closed season is never early or new', () => {
    const view = ladder([], {}, null, closedSeason);
    assert({
      given: 'a closed season with no rows',
      should: 'be a filtered empty table and never early',
      actual: [view.early, view.empty],
      expected: [false, 'filtered'],
    });
  });
});
