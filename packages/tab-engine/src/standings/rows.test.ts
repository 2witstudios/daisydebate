import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  debate,
  entry,
  inputOf,
  tableOf,
  twoSides,
  withTiebreaks,
  valuesOf,
} from './build.test-support';
import { standings } from './index';

setupRitewayBun();

describe('standings rows', () => {
  const played = [
    debate('a', 1, ['N1', 'V1'], 'N1'),
    debate('b', 1, ['N2', 'V2'], 'V2'),
    debate('c', 2, ['V1', 'V2'], 'V1'),
  ];
  const entries = [
    entry('V1', { division: 'varsity' }),
    entry('N1', { division: 'novice' }),
    entry('V2', { division: 'varsity' }),
    entry('N2', { division: 'novice', status: 'withdrawn' }),
  ];

  test('a division selects rows and keeps every result', () => {
    const table = standings(
      inputOf(
        twoSides,
        entries,
        played,
        withTiebreaks(['wins', 'opponent_wins']),
        { division: 'novice' },
      ),
    );
    assert({
      given: 'the novice division, N1 having beaten a varsity entry',
      should:
        'list both novices, the withdrawn one too, counting the cross-division win',
      actual: [tableOf(table.rows), valuesOf(table, 'N1'), table.results],
      expected: [
        ['1 N1 ·', '2 N2 wins'],
        { wins: '1', opponent_wins: '1' },
        ['a-r', 'b-r', 'c-r'],
      ],
    });
  });

  test('no snapshot is unrated, and every rating is level', () => {
    const table = standings(
      inputOf(twoSides, entries, [], withTiebreaks(['rating'])),
    );
    assert({
      given: 'no rating snapshot',
      should: 'say unrated and share every row',
      actual: [table.rated, table.rows.map((r) => r.separatedBy)],
      expected: [false, [null, 'shared', 'shared', 'shared']],
    });
  });

  test('the lot is seeded and ignores the order entries were listed in', () => {
    const settings = withTiebreaks(['wins'], 'lot');
    const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
    const forward = standings(
      inputOf(
        twoSides,
        ids.map((id) => entry(id)),
        [],
        settings,
      ),
    );
    const backward = standings(
      inputOf(
        twoSides,
        [...ids].reverse().map((id) => entry(id)),
        [],
        settings,
      ),
    );
    const other = standings(
      inputOf(
        twoSides,
        ids.map((id) => entry(id)),
        [],
        settings,
        { seed: new Uint8Array([1]) },
      ),
    );
    assert({
      given: 'six level entries, listed forward and backward, and another seed',
      should: 'draw the same lot for the same seed, ranked one to six',
      actual: [
        tableOf(forward.rows).join() === tableOf(backward.rows).join(),
        forward.rows.map((r) => r.rank),
        forward.rows.slice(1).every((r) => r.separatedBy === 'lot'),
        tableOf(forward.rows).join() === tableOf(other.rows).join(),
      ],
      expected: [true, [1, 2, 3, 4, 5, 6], true, false],
    });
  });
});
