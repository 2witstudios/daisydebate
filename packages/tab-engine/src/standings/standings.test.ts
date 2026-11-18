import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { Metric } from '../shapes/settings';
import {
  debate,
  entry,
  fourSides,
  inputOf,
  room,
  section,
  speakers,
  tableOf,
  twoSides,
  withTiebreaks,
  valuesOf,
} from './build.test-support';
import { standings } from './index';

setupRitewayBun();

const all: Metric[] = [
  'wins',
  'win_percentage',
  'ballot_count',
  'total_points',
  'high_low_points',
  'opponent_wins',
  'opponent_points',
  'cumulative_rank',
  'reciprocals',
  'team_points',
  'count_back',
  'rank_truncation',
  'worst_rank_drop',
];

describe('standings metrics', () => {
  test('two-sided metrics read every ballot of a panel', () => {
    /*
     * R1  A > B on a 2-1 panel: ballots A (28, 27), A (29, 26), B (27, 28)
     * R2  C > A unanimously on one ballot (27, 28)
     * A: wins 1 of 2; ballots won 2; points 28 + 29 + 27 + 27 = 111; ballot ranks
     * 1, 1, 2, 2 -> cumulative 6, reciprocals 3, worst dropped 4.
     */
    const played = [
      debate(
        'm1',
        1,
        ['A', 'B'],
        'A',
        [0, 0],
        [
          ['A', 28, 27],
          ['A', 29, 26],
          ['B', 27, 28],
        ],
      ),
      debate('m2', 2, ['C', 'A'], 'C', [28, 27]),
    ];
    const table = standings(
      inputOf(
        twoSides,
        [entry('A'), entry('B'), entry('C')],
        played,
        withTiebreaks(all),
      ),
    );
    assert({
      given: 'a split decision and a loss',
      should: 'count wins, ballots, points, ranks and opponents as defined',
      actual: valuesOf(table, 'A'),
      expected: {
        wins: '1',
        win_percentage: '1/2',
        ballot_count: '2',
        total_points: '111',
        high_low_points: '111',
        opponent_wins: '1',
        opponent_points: '109',
        cumulative_rank: '6',
        reciprocals: '3',
        team_points: '1',
        count_back: '1,1,0,0,0,0,0',
        rank_truncation: '6',
        worst_rank_drop: '4',
      },
    });
  });

  test('a double loss is a win for nobody', () => {
    const table = standings(
      inputOf(
        twoSides,
        [entry('A'), entry('B')],
        [debate('d', 1, ['A', 'B'], null, [27, 27], [[null, 27, 27]])],
        withTiebreaks(['wins', 'ballot_count']),
      ),
    );
    assert({
      given: 'a double loss',
      should: 'give neither side a win or a ballot, so they share first',
      actual: [tableOf(table.rows), valuesOf(table, 'B')],
      expected: [['1 A ·', '1 B shared'], { wins: '0', ballot_count: '0' }],
    });
  });

  test('rank truncation caps each rank at the smallest section of its round', () => {
    // Round 1 has sections of 5 and 3: every rank that round counts at most 3.
    const played = [
      section(
        't1',
        1,
        ['A', 'B', 'C', 'D', 'E'],
        ['B', 'C', 'D', 'E', 'A'],
        [
          [
            ['B', 1, 0],
            ['C', 2, 0],
            ['D', 3, 0],
            ['E', 4, 0],
            ['A', 5, 0],
          ],
        ],
      ),
      section(
        't2',
        1,
        ['F', 'G', 'H'],
        ['F', 'G', 'H'],
        [
          [
            ['F', 1, 0],
            ['G', 2, 0],
            ['H', 3, 0],
          ],
        ],
      ),
    ];
    const table = standings(
      inputOf(
        speakers,
        ['A', 'E', 'H'].map((id) => entry(id)),
        played,
        withTiebreaks(['rank_truncation', 'cumulative_rank']),
      ),
    );
    assert({
      given:
        'A ranked 5th, E 4th and H 3rd, the smallest section of the round being 3',
      should: 'truncate all three to 3, so only cumulative rank separates them',
      actual: tableOf(table.rows),
      expected: ['1 H ·', '2 E cumulative_rank', '3 A cumulative_rank'],
    });
  });

  test('four-side team points and places', () => {
    const played = [
      room(
        'q',
        1,
        ['A', 'B', 'C', 'D'],
        ['C', 'A', 'D', 'B'],
        [
          [
            ['C', 1, 0],
            ['A', 2, 0],
            ['D', 3, 0],
            ['B', 4, 0],
          ],
        ],
      ),
    ];
    const table = standings(
      inputOf(
        fourSides,
        ['A', 'B', 'C', 'D'].map((id) => entry(id)),
        played,
        withTiebreaks(['team_points', 'wins']),
      ),
    );
    assert({
      given: 'places C, A, D, B',
      should: 'award 3, 2, 1 and 0 team points, and a win only to the first',
      actual: table.rows.map(
        (r) =>
          `${r.entry} ${valuesOf(table, r.entry).team_points} ${valuesOf(table, r.entry).wins}`,
      ),
      expected: ['C 3 1', 'A 2 0', 'D 1 0', 'B 0 0'],
    });
  });

  test('head to head leaves a group of three, or a pair who never met, tied', () => {
    // A > B, B > C, C > A: a cycle, all on one win. D and E, on two, never meet.
    const played = [
      debate('c1', 1, ['A', 'B'], 'A'),
      debate('c2', 2, ['B', 'C'], 'B'),
      debate('c3', 3, ['C', 'A'], 'C'),
      debate('c4', 1, ['D', 'F'], 'D'),
      debate('c5', 2, ['E', 'F'], 'E'),
      debate('c6', 2, ['D', 'G'], 'D'),
      debate('c7', 1, ['E', 'G'], 'E'),
    ];
    const settings = withTiebreaks(['wins', 'head_to_head'], 'shared');
    const table = standings(
      inputOf(
        twoSides,
        ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((id) => entry(id)),
        played,
        settings,
      ),
    );
    assert({
      given: 'a three-way cycle and a pair who never met, D and E on two wins',
      should: 'separate neither group by head to head',
      actual: tableOf(table.rows),
      expected: [
        '1 D ·',
        '1 E shared',
        '3 A wins',
        '3 B shared',
        '3 C shared',
        '6 F wins',
        '6 G shared',
      ],
    });
  });
});
