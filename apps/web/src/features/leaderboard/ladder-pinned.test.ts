import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { PAGE_SIZE } from './ladder-view';
import { entry } from './standing.test-support';
import { field, ladder } from './ladder.test-support';

setupRitewayBun();

describe('pinned standing', () => {
  const viewer = { username: 'me', blinded: [] };
  const established = [
    ...field(30),
    entry({ id: 'me', username: 'me', rating: 1300, weekChange: 2 }),
  ];

  test('signed out', () => {
    assert({
      given: 'no viewer',
      should: 'pin an invitation to sign in',
      actual: ladder(field(12)).pinned,
      expected: { kind: 'signed-out' },
    });
  });

  test('no ranked debates', () => {
    assert({
      given: 'a viewer with no line this season',
      should: 'pin the absent state and hide Around me',
      actual: [
        ladder(field(12), {}, viewer).pinned.kind,
        ladder(field(12), {}, viewer).hasStanding,
      ],
      expected: ['absent', false],
    });
  });

  test('established', () => {
    const view = ladder(established, {}, viewer);
    assert({
      given: 'an established viewer ranked 31st',
      should: 'pin the rank and a link to the page holding them',
      actual: [
        view.pinned.kind === 'established' && view.pinned.rank,
        view.pinned.kind === 'established' && view.pinned.jumpHref,
        view.rows.length,
      ],
      expected: [31, '/leaderboard?page=3', PAGE_SIZE - 3],
    });
    assert({
      given: 'the viewer’s own row',
      should: 'be marked as theirs',
      actual: ladder(established, { page: 3 }, viewer).rows.map(
        (row) => row.me,
      ),
      expected: [true],
    });
  });

  test('provisional', () => {
    const view = ladder(
      [
        ...field(12),
        entry({ id: 'me', username: 'me', rating: 1650, played: 7 }),
      ],
      {},
      viewer,
    );
    assert({
      given: 'a viewer with seven of ten ranked debates',
      should: 'pin progress, where they would rank, and a link to Everyone',
      actual: view.pinned.kind === 'provisional' && {
        played: view.pinned.played,
        remaining: view.pinned.remaining,
        percent: view.pinned.percent,
        wouldRank: view.pinned.wouldRank,
        jumpHref: view.pinned.jumpHref,
      },
      expected: {
        played: 7,
        remaining: 3,
        percent: 70,
        wouldRank: 6,
        jumpHref: '/leaderboard?status=everyone',
      },
    });
  });
});

describe('Around me', () => {
  const me = entry({ id: 'me', username: 'me', rating: 1300 });
  const viewer = { username: 'me', blinded: [] };

  test('a window of eleven ranks', () => {
    const view = ladder([...field(30), me], { scope: 'around' }, viewer);
    assert({
      given: 'the viewer ranked 31st of 31',
      should: 'show the five above and themselves, with a rank range note',
      actual: [
        view.around,
        view.rows.map((row) => row.rank),
        view.gapNote,
        view.pageCount,
        view.podium.length,
      ],
      expected: [true, [26, 27, 28, 29, 30, 31], 'Ranks 26 to 31', 1, 0],
    });
  });

  test('a provisional viewer', () => {
    const view = ladder(
      [...field(30), { ...me, played: 4 }],
      { scope: 'around' },
      viewer,
    );
    assert({
      given: 'a provisional viewer',
      should: 'show where they would sit instead of a rank',
      actual: [view.gapNote, view.rows.at(-1)?.me],
      expected: ['Where you would sit: around rank 31 at rating 1300', true],
    });
  });

  test('without a standing', () => {
    assert({
      given: 'Around me asked for by someone with no line',
      should: 'fall back to the top of the ladder',
      actual: [
        ladder(field(30), { scope: 'around' }, viewer).around,
        ladder(field(30), { scope: 'around' }).around,
      ],
      expected: [false, false],
    });
  });
});
