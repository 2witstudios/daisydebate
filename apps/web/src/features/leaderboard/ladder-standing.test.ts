import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { entry } from './standing.test-support';
import { field, ladder } from './ladder.test-support';

setupRitewayBun();

describe('your standing', () => {
  const viewer = { username: 'me', blinded: [] };

  test('no ranked debates', () => {
    assert({
      given: 'a visitor, and a viewer with no line this season',
      should: 'hide Around me',
      actual: [
        ladder(field(12)).hasStanding,
        ladder(field(12), {}, viewer).hasStanding,
      ],
      expected: [false, false],
    });
  });

  test('your own row', () => {
    const view = ladder(
      [
        ...field(30),
        entry({ id: 'me', username: 'me', rating: 1300, weekChange: 2 }),
      ],
      { page: 3 },
      viewer,
    );
    assert({
      given: 'an established viewer ranked 31st',
      should: 'offer Around me and mark their row as theirs',
      actual: [view.hasStanding, view.rows.map((row) => row.me)],
      expected: [true, [true]],
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
