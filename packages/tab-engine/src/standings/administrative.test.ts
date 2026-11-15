import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  baseSettings,
  debate,
  entry,
  historyOf,
  inputOf,
  twoSides,
  valuesOf,
  withTiebreaks,
} from './build.test-support';
import { standings } from './index';
import { tallyOf } from './tally';

setupRitewayBun();

test('administrative credits remain distinct from submitted judge ballots', () => {
  const played = debate('played', 1, ['A', 'B'], 'A', [30, 25]);
  const held = debate('award', 2, ['A', 'B'], 'B');
  const history = historyOf([played]);
  const input = inputOf(
    twoSides,
    [entry('A'), entry('B')],
    [],
    withTiebreaks(['wins', 'ballot_count', 'total_points', 'cumulative_rank']),
  );
  const actualInput = {
    ...input,
    history: {
      fixtures: [...history.fixtures, held.fixture],
      results: [
        ...history.results,
        {
          id: 'award-result',
          fixture: 'award',
          kind: 'administrative' as const,
          supersedes: null,
          certified: false,
          outcome: {
            kind: 'winner' as const,
            winner: 'B',
            credits: {
              kind: 'awarded' as const,
              entries: [
                { entry: 'A', ballotsWon: 0, ranks: [2, 2, 2], points: 12 },
                { entry: 'B', ballotsWon: 3, ranks: [1, 1, 1], points: 15 },
              ],
            },
          },
        },
      ],
    },
  };
  assert({
    given: 'a real ballot and a separately authored administrative award',
    should: 'count explicit credits without fabricating judges',
    actual: [
      valuesOf(standings(actualInput), 'B'),
      ['played', 'award'].map(
        (id) =>
          tallyOf(actualInput)
            .games.get('B')
            ?.find((g) => g.fixture === id)?.ballots.length,
      ),
    ],
    expected: [
      {
        wins: '1',
        ballot_count: '3',
        total_points: '40',
        cumulative_rank: '5',
      },
      [1, 0],
    ],
  });
});

test('bye folds use the authored policy and panel instead of current settings', () => {
  const played = debate('played', 1, ['A', 'B'], 'A', [30, 25]);
  const history = historyOf([played]);
  const fixtures = ['win', 'average'].map((id, i) => ({
    id,
    tabRound: i + 2,
    fixture: { kind: 'bye' as const, entry: 'A' },
  }));
  const results = fixtures.map(({ id }, i) => ({
    id: `${id}-result`,
    fixture: id,
    kind: 'administrative' as const,
    supersedes: null,
    certified: true,
    outcome: {
      kind: 'winner' as const,
      winner: 'A',
      credits: {
        kind: 'bye' as const,
        rule: i === 0 ? ('win' as const) : ('own_average' as const),
        panelSize: 3,
      },
    },
  }));
  const input = inputOf(
    twoSides,
    [entry('A')],
    [],
    withTiebreaks(['wins', 'ballot_count', 'total_points'], 'shared', null, {
      ...baseSettings,
      'bye.result': { value: 'win' },
    }),
  );
  assert({
    given:
      'one played win, one win bye, one own-average bye and changed settings',
    should: 'add each frozen credit exactly once',
    actual: [
      valuesOf(
        standings({
          ...input,
          history: {
            fixtures: [...history.fixtures, ...fixtures],
            results: [...history.results, ...results],
          },
        }),
        'A',
      ),
    ],
    expected: [{ wins: '3', ballot_count: '5', total_points: '60' }],
  });
});
