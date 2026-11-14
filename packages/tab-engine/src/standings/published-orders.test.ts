/*
 * Hand-worked standings tables (TAB-7.11). The e09 research page with the
 * published tiebreak orders was not reachable when these were written, so
 * each order below is restated from the published rules as the builder
 * knows them. Every table is a small tournament worked on paper; the
 * expected rows are written out one by one as `rank entry separatedBy`
 * (`-` is unranked, `·` the first row).
 */
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
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
  valueOf,
  withTiebreaks,
} from './build.test-support';
import { standings } from './index';

setupRitewayBun();

describe('hand-worked published orders', () => {
  test('(a) NSDA Lincoln-Douglas: wins, high-low points, total points, opponent wins', () => {
    /*
     * Six debaters, three rounds, one judge.
     *   R1  A 29 > B 27   C 28 > D 27   E 29 > F 26
     *   R2  A 28 > C 26   E 28 > D 26   B 28 > F 27
     *   R3  A 28 > E 27   B 29 > C 27   F 29 > D 25
     * Wins: A 3; B 2, E 2; C 1, F 1; D 0.
     * B: 27 28 29 -> high-low 28, total 84; E: 29 28 27 -> 28, 84. Tied, so
     * opponent wins: B met A 3, F 1, C 1 = 5; E met F 1, D 0, A 3 = 4. B first.
     * C: 28 26 27 -> high-low 27, total 81; F: 26 27 29 -> 27, 82. F first by total.
     */
    const played = [
      debate('r1a', 1, ['A', 'B'], 'A', [29, 27]),
      debate('r1b', 1, ['C', 'D'], 'C', [28, 27]),
      debate('r1c', 1, ['E', 'F'], 'E', [29, 26]),
      debate('r2a', 2, ['A', 'C'], 'A', [28, 26]),
      debate('r2b', 2, ['E', 'D'], 'E', [28, 26]),
      debate('r2c', 2, ['B', 'F'], 'B', [28, 27]),
      debate('r3a', 3, ['A', 'E'], 'A', [28, 27]),
      debate('r3b', 3, ['B', 'C'], 'B', [29, 27]),
      debate('r3c', 3, ['F', 'D'], 'F', [29, 25]),
    ];
    const settings = withTiebreaks([
      'wins',
      'high_low_points',
      'total_points',
      'opponent_wins',
    ]);
    const table = standings(
      inputOf(
        twoSides,
        ['A', 'B', 'C', 'D', 'E', 'F'].map((id) => entry(id)),
        played,
        settings,
      ),
    );
    assert({
      given: 'the six-debater tournament above',
      should: 'rank by wins, then high-low, then total, then opponent wins',
      actual: tableOf(table.rows),
      expected: [
        '1 A ·',
        '2 B wins',
        '3 E opponent_wins',
        '4 F wins',
        '5 C total_points',
        '6 D wins',
      ],
    });
    assert({
      given: 'B and E level on wins, high-low and total',
      should: 'carry the values worked above',
      actual: [
        valueOf(table.rows, 'B', 'high_low_points'),
        valueOf(table.rows, 'E', 'opponent_wins'),
      ],
      expected: [[{ n: 28, d: 1 }], [{ n: 4, d: 1 }]],
    });
  });

  test('(b) British Parliamentary: team points, total speaker points, count-back', () => {
    /*
     * Four teams in one room for three rounds, one judge; team points 3 2 1 0.
     *   R1  P 1st 78, Q 2nd 76, R 3rd 74, S 4th 73
     *   R2  Q 1st 77, R 2nd 76, P 3rd 74, S 4th 72
     *   R3  S 1st 79, P 2nd 78, Q 3rd 75, R 4th 74
     * Team points: P 3+1+2 = 6, Q 2+3+1 = 6, R 1+2+0 = 3, S 0+0+3 = 3.
     * Speaker points: P 230, Q 228 -> P first. R 224, S 224: level.
     * Count-back: S has a first (1,0,0,2); R has none (0,1,1,1). S first.
     */
    const ranks = (order: readonly (readonly [string, number])[]) => [
      order.map(([id, points], i) => [id, i + 1, points] as const),
    ];
    const played = [
      room(
        'b1',
        1,
        ['P', 'Q', 'R', 'S'],
        ['P', 'Q', 'R', 'S'],
        ranks([
          ['P', 78],
          ['Q', 76],
          ['R', 74],
          ['S', 73],
        ]),
      ),
      room(
        'b2',
        2,
        ['Q', 'R', 'P', 'S'],
        ['Q', 'R', 'P', 'S'],
        ranks([
          ['Q', 77],
          ['R', 76],
          ['P', 74],
          ['S', 72],
        ]),
      ),
      room(
        'b3',
        3,
        ['S', 'P', 'Q', 'R'],
        ['S', 'P', 'Q', 'R'],
        ranks([
          ['S', 79],
          ['P', 78],
          ['Q', 75],
          ['R', 74],
        ]),
      ),
    ];
    const settings = withTiebreaks([
      'team_points',
      'total_points',
      'count_back',
    ]);
    const table = standings(
      inputOf(
        fourSides,
        ['P', 'Q', 'R', 'S'].map((id) => entry(id)),
        played,
        settings,
      ),
    );
    assert({
      given: 'the four-team tournament above',
      should: 'rank by team points, then speaker points, then count-back',
      actual: tableOf(table.rows),
      expected: [
        '1 P ·',
        '2 Q total_points',
        '3 S team_points',
        '4 R count_back',
      ],
    });
    assert({
      given: 'S with a first and two fourths',
      should: 'count back as one first, no second or third, two fourths',
      actual: valueOf(table.rows, 'S', 'count_back')?.map((v) => v.n),
      expected: [1, 0, 0, 2, 0, 0, 0],
    });
  });

  test('(c) individual events: cumulative rank, reciprocals, total points', () => {
    /*
     * One section of four speakers, two judges.
     *   J1  W 1 (95), X 2 (90), Y 3 (88), Z 4 (85)
     *   J2  Z 1 (94), Y 2 (92), X 3 (89), W 4 (86)
     * Cumulative rank: everyone 5. Reciprocals: W and Z 1 + 1/4 = 5/4;
     * X and Y 1/2 + 1/3 = 5/6. Points: W 181 > Z 179; Y 180 > X 179.
     */
    const played = [
      section(
        's1',
        1,
        ['W', 'X', 'Y', 'Z'],
        ['W', 'Z', 'Y', 'X'],
        [
          [
            ['W', 1, 95],
            ['X', 2, 90],
            ['Y', 3, 88],
            ['Z', 4, 85],
          ],
          [
            ['Z', 1, 94],
            ['Y', 2, 92],
            ['X', 3, 89],
            ['W', 4, 86],
          ],
        ],
      ),
    ];
    const settings = withTiebreaks([
      'cumulative_rank',
      'reciprocals',
      'total_points',
    ]);
    const table = standings(
      inputOf(
        speakers,
        ['W', 'X', 'Y', 'Z'].map((id) => entry(id)),
        played,
        settings,
      ),
    );
    assert({
      given: 'the section above, everyone on a cumulative rank of 5',
      should: 'rank by reciprocals, then total points',
      actual: tableOf(table.rows),
      expected: [
        '1 W ·',
        '2 Z total_points',
        '3 Y reciprocals',
        '4 X total_points',
      ],
    });
    assert({
      given: 'Y ranked 3rd and 2nd',
      should: 'hold reciprocals of exactly 5/6',
      actual: valueOf(table.rows, 'Y', 'reciprocals'),
      expected: [{ n: 5, d: 6 }],
    });
  });

  test('(d) a windowed stage: win percentage with a minimum of two games', () => {
    /*
     *   R1  G > K, H > J      (I does not debate)
     *   R2  G > H, I > J
     *   R3  H > K             (G, I, J do not debate)
     * G 2-0 = 1, H 2-1 = 2/3, I 1-0 but one game (unranked), J 0-2 and K 0-2 = 0.
     * J and K stay level: a shared tie, both third.
     */
    const played = [
      debate('w1a', 1, ['G', 'K'], 'G'),
      debate('w1b', 1, ['H', 'J'], 'H'),
      debate('w2a', 2, ['G', 'H'], 'G'),
      debate('w2b', 2, ['I', 'J'], 'I'),
      debate('w3a', 3, ['H', 'K'], 'H'),
    ];
    const settings = withTiebreaks(['win_percentage'], 'shared', 2);
    const table = standings(
      inputOf(
        twoSides,
        ['G', 'H', 'I', 'J', 'K'].map((id) => entry(id)),
        played,
        settings,
      ),
    );
    assert({
      given: 'entries with one, two and three games',
      should:
        'rank by win percentage, share the level pair, and list I unranked last',
      actual: tableOf(table.rows),
      expected: [
        '1 G ·',
        '2 H win_percentage',
        '3 J win_percentage',
        '3 K shared',
        '- I minimum_games',
      ],
    });
    assert({
      given: 'H with two wins in three games',
      should: 'hold a win percentage of exactly 2/3',
      actual: valueOf(table.rows, 'H', 'win_percentage'),
      expected: [{ n: 2, d: 3 }],
    });
  });

  test('(e) level on everything but rating, one entry unrated', () => {
    /*
     *   R1  M 28 > O 27, N 28 > P 27
     * M and N: 1 win, 28 points; O and P: 0 wins, 27 points.
     * Ratings: N 1600, M 1500, O 1400, P unrated (below every rated entry).
     */
    const played = [
      debate('e1', 1, ['M', 'O'], 'M', [28, 27]),
      debate('e2', 1, ['N', 'P'], 'N', [28, 27]),
    ];
    const ratings = {
      ladder: 'l',
      takenAt: '2026-01-01T00:00:00Z',
      calculation: 'glicko-2',
      entries: [
        { entry: 'M', status: 'rated' as const, rating: 1500, deviation: 50 },
        { entry: 'N', status: 'rated' as const, rating: 1600, deviation: 50 },
        { entry: 'O', status: 'rated' as const, rating: 1400, deviation: 50 },
        { entry: 'P', status: 'unrated' as const },
      ],
    };
    const settings = withTiebreaks(['wins', 'total_points', 'rating']);
    const table = standings(
      inputOf(
        twoSides,
        ['M', 'N', 'O', 'P'].map((id) => entry(id)),
        played,
        settings,
        { ratings },
      ),
    );
    assert({
      given: 'two level pairs and a rating snapshot with P unrated',
      should:
        'order each pair by rating, the unrated entry below the rated one',
      actual: [tableOf(table.rows), table.rated],
      expected: [['1 N ·', '2 M rating', '3 O wins', '4 P rating'], true],
    });
  });

  test('(f) a tie broken by head to head', () => {
    /*
     *   R1  A > B, C > D
     *   R2  B > C, A > D
     * A 2 wins; B and C 1 each, and B beat C in R2; D 0.
     */
    const played = [
      debate('h1a', 1, ['A', 'B'], 'A'),
      debate('h1b', 1, ['C', 'D'], 'C'),
      debate('h2a', 2, ['B', 'C'], 'B'),
      debate('h2b', 2, ['A', 'D'], 'A'),
    ];
    const settings = withTiebreaks(['wins', 'head_to_head'], 'lot');
    const table = standings(
      inputOf(
        twoSides,
        ['A', 'B', 'C', 'D'].map((id) => entry(id)),
        played,
        settings,
      ),
    );
    assert({
      given: 'B and C level on wins, B having won their meeting',
      should: 'put B above C by head to head',
      actual: [
        tableOf(table.rows),
        valueOf(table.rows, 'B', 'head_to_head'),
        valueOf(table.rows, 'A', 'head_to_head'),
      ],
      expected: [
        ['1 A ·', '2 B wins', '3 C head_to_head', '4 D wins'],
        [{ n: 1, d: 1 }],
        [],
      ],
    });
  });
});
