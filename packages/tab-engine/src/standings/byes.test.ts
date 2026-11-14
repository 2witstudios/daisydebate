import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { Metric } from '../shapes/settings';
import {
  baseSettings,
  bye,
  debate,
  entry,
  inputOf,
  twoSides,
  withTiebreaks,
  valuesOf,
} from './build.test-support';
import { standings } from './index';

setupRitewayBun();

describe('standings byes', () => {
  // A: bye in R1, then 28 > B in R2 and 26 < C in R3; a three-judge panel.
  const played = [
    bye<typeof twoSides>('y1', 1, 'A'),
    debate('y2', 2, ['A', 'B'], 'A', [28, 27]),
    debate('y3', 3, ['C', 'A'], 'C', [29, 26]),
  ];
  const metrics: Metric[] = [
    'wins',
    'win_percentage',
    'ballot_count',
    'total_points',
    'high_low_points',
    'count_back',
  ];
  const panel = {
    ...baseSettings['judging.panel'],
    preliminary: { size: 3, decision: 'majority' as const },
  };

  test('a bye that is a win', () => {
    const settings = withTiebreaks(metrics, 'shared', null, {
      ...baseSettings,
      'judging.panel': panel,
    });
    const table = standings(inputOf(twoSides, [entry('A')], played, settings));
    assert({
      given: 'a bye counted as a win, panels of three',
      should:
        'count a game, a win, a first place and three ballots, but no points',
      actual: [table.rows[0]?.games, valuesOf(table, 'A')],
      expected: [
        3,
        {
          wins: '2',
          win_percentage: '2/3',
          ballot_count: '4',
          total_points: '54',
          high_low_points: '54',
          count_back: '2,1,0,0,0,0,0',
        },
      ],
    });
  });

  test('a bye that is the entry’s own average', () => {
    const settings = withTiebreaks(metrics, 'shared', null, {
      ...baseSettings,
      'judging.panel': panel,
      'bye.result': { value: 'own_average' },
    });
    const table = standings(inputOf(twoSides, [entry('A')], played, settings));
    assert({
      given: 'one bye over two played games (1 win, 54 points)',
      should:
        'scale every total by 3/2 and keep the win percentage of the played games',
      actual: valuesOf(table, 'A'),
      expected: {
        wins: '3/2',
        win_percentage: '1/2',
        ballot_count: '3/2',
        total_points: '81',
        high_low_points: '81',
        count_back: '3/2,3/2,0,0,0,0,0',
      },
    });
  });

  test('an own-average bye with nothing played adds nothing', () => {
    const settings = withTiebreaks(['wins', 'win_percentage'], 'shared', null, {
      ...baseSettings,
      'bye.result': { value: 'own_average' },
    });
    const table = standings(
      inputOf(
        twoSides,
        [entry('A')],
        [bye<typeof twoSides>('y', 1, 'A')],
        settings,
      ),
    );
    assert({
      given: 'a single own-average bye',
      should: 'count the game but no win',
      actual: [table.rows[0]?.games, valuesOf(table, 'A')],
      expected: [1, { wins: '0', win_percentage: '0' }],
    });
  });

  test('a bye after the cutoff is not a game', () => {
    const table = standings(
      inputOf(twoSides, [entry('A')], played, withTiebreaks(['wins']), {
        cutoff: 0,
      }),
    );
    assert({
      given: 'cutoff 0',
      should: 'count no games and read no results',
      actual: [table.rows[0]?.games, table.results],
      expected: [0, []],
    });
  });
});
