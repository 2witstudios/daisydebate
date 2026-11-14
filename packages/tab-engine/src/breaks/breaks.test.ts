import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { Id, RatingSnapshot } from '../shapes/competition';
import type { BreakLine } from '../shapes/settings';
import { entry } from '../standings/build.test-support';
import {
  record,
  settingsWith,
  breakInput,
  seedsOf,
} from './build.test-support';
import { breaks } from './index';

setupRitewayBun();

describe('break lines', () => {
  // A 3-0, B 3-0, C 2-1, D 2-1, E 2-1, F 1-2, G 1-2, H 0-3; points order within a record.
  const table: [Id, number, number][] = [
    ['A', 3, 30],
    ['B', 3, 29],
    ['C', 2, 28],
    ['D', 2, 27],
    ['E', 2, 26],
    ['F', 1, 25],
    ['G', 1, 24],
    ['H', 0, 23],
  ];
  const entries = table.map(([id]) => entry(id));
  const played = table.flatMap(([id, wins, points]) =>
    record(id, wins, 3 - wins, points),
  );
  const lineBreak = (line: BreakLine) =>
    seedsOf(
      breaks(
        breakInput(
          entries,
          played,
          settingsWith({ 'break.line': { default: line, byDivision: {} } }),
          [{ id: 'elim', division: null }],
        ),
      ),
    );

  test('tie-inclusive with its ceiling', () => {
    const line = (
      size: number,
      ceiling: number,
      metrics: 'wins' | 'wins+points',
    ) =>
      seedsOf(
        breaks(
          breakInput(
            entries,
            played,
            settingsWith({
              'break.line': {
                default: { kind: 'tie_inclusive', size, ceiling },
                byDivision: {},
              },
              'standings.tiebreaks': {
                metrics:
                  metrics === 'wins' ? ['wins'] : ['wins', 'total_points'],
                minimumGames: null,
                terminal: 'shared',
              },
            }),
            [{ id: 'elim', division: null }],
          ),
        ),
      );
    assert({
      given:
        'a tie-inclusive break of 3 where the third seed C is tied with D and E on every tiebreak, and then where points separate them',
      should:
        'take D and E too under a ceiling of 5, exactly 3 under a ceiling of 4, and exactly 3 when points separate C from D',
      actual: [
        line(3, 5, 'wins'),
        line(3, 4, 'wins'),
        line(3, 5, 'wins+points'),
      ],
      expected: [['elim: A B C D E'], ['elim: A B C'], ['elim: A B C']],
    });
  });

  test('fixed, record and capped record lines', () => {
    assert({
      given:
        'a fixed 2, a record of 2 wins, a capped record (2 wins, cap 2) and a floor of 4 over 3 wins',
      should:
        'break the top 2; the five on 2 or more; the top 2 of them, filled to 3; and A, B filled to 4',
      actual: [
        lineBreak({ kind: 'fixed', size: 2 }),
        lineBreak({ kind: 'record', wins: 2 }),
        lineBreak({ kind: 'record_capped', wins: 2, cap: 2, floor: 3 }),
        lineBreak({ kind: 'record_capped', wins: 3, cap: 5, floor: 4 }),
      ],
      expected: [
        ['elim: A B'],
        ['elim: A B C D E'],
        ['elim: A B C'],
        ['elim: A B C D'],
      ],
    });
  });
});

describe('double qualifiers', () => {
  /*
   * Open (any division, highest precedence) and Novice breaks, two each.
   * N1 3-0, O1 2-1, O2 1-2 (28), N2 1-2 (27), N3 0-3. N1 clears both lines.
   */
  const entries = [
    entry('N1', { division: 'novice' }),
    entry('O1', { division: 'open' }),
    entry('O2', { division: 'open' }),
    entry('N2', { division: 'novice' }),
    entry('N3', { division: 'novice' }),
  ];
  const played = [
    ...record('N1', 3, 0),
    ...record('O1', 2, 1),
    ...record('O2', 1, 2, 28),
    ...record('N2', 1, 2, 27),
    ...record('N3', 0, 3),
  ];
  const stages = [
    { id: 'open', division: null },
    { id: 'novice', division: 'novice' },
  ];
  const under = (
    rule: 'higher' | 'both' | 'choice',
    choices: Record<Id, Id> = {},
  ) =>
    seedsOf(
      breaks(
        breakInput(
          entries,
          played,
          settingsWith({
            'break.line': {
              default: { kind: 'fixed', size: 2 },
              byDivision: {},
            },
            'break.double_qualifier': { value: rule },
          }),
          stages,
          { choices },
        ),
      ),
    );

  test('higher: the higher stage keeps the entry and the next entry takes its place', () => {
    assert({
      given: 'N1 through to Open and Novice',
      should: 'keep N1 in Open and break N2 and N3 in Novice',
      actual: under('higher'),
      expected: ['open: N1 O1', 'novice: N2 N3'],
    });
  });

  test('both: the entry is in both brackets', () => {
    assert({
      given: 'N1 through to Open and Novice',
      should: 'break N1 in each',
      actual: under('both'),
      expected: ['open: N1 O1', 'novice: N1 N2'],
    });
  });

  test('choice: the chosen stage keeps the entry', () => {
    assert({
      given: 'N1 choosing Novice',
      should: 'take N1 out of Open, where O2 takes the place',
      actual: under('choice', { N1: 'novice' }),
      expected: ['open: O1 O2', 'novice: N1 N2'],
    });
  });

  test('choice without a choice is undecided', () => {
    assert({
      given: 'N1 through to both and no choice recorded',
      should: 'answer undecided, naming N1 and both stages, with no brackets',
      actual: under('choice'),
      expected: {
        kind: 'undecided',
        entries: [{ entry: 'N1', stages: ['open', 'novice'] }],
      },
    });
  });

  test('a division line overrides the default', () => {
    const settings = settingsWith({
      'break.line': {
        default: { kind: 'fixed', size: 2 },
        byDivision: { novice: { kind: 'fixed', size: 1 } },
      },
    });
    assert({
      given: 'a novice line of one under higher',
      should: 'break only N2 in Novice',
      actual: seedsOf(breaks(breakInput(entries, played, settings, stages))),
      expected: ['open: N1 O1', 'novice: N2'],
    });
  });
});

describe('open-registration single elimination', () => {
  const ratings: RatingSnapshot = {
    ladder: 'l',
    takenAt: '2026-01-01T00:00:00Z',
    calculation: 'glicko-2',
    entries: [
      { entry: 'a', status: 'rated', rating: 1500, deviation: 80 },
      { entry: 'b', status: 'rated', rating: 1700, deviation: 60 },
      { entry: 'c', status: 'rated', rating: 1500, deviation: 40 },
      { entry: 'd', status: 'unrated' },
      { entry: 'f', status: 'rated', rating: 1900, deviation: 40 },
    ],
  };
  const entries = [
    entry('a'),
    entry('b'),
    entry('c'),
    entry('d'),
    entry('e'),
    entry('f', { status: 'withdrawn' }),
    entry('g', { breakEligible: false }),
  ];
  const settings = settingsWith({
    'break.seeding': { value: 'rating' },
    'break.line': { default: { kind: 'fixed', size: 64 }, byDivision: {} },
  });

  test('everyone breaks, seeded by rating, from no results at all', () => {
    const answer = breaks(
      breakInput(entries, [], settings, [{ id: 'bracket', division: null }], {
        ratings,
        cutoff: 0,
      }),
    );
    const seeds =
      answer.kind === 'resolved' ? answer.stages[0]!.bracket.seeds : [];
    assert({
      given: 'five eligible active entries, two level on rating, two unrated',
      should: 'seed by rating, then lower deviation, the unrated last by lot',
      actual: [seeds.slice(0, 3), [...seeds.slice(3)].sort(), seeds.length],
      expected: [['b', 'c', 'a'], ['d', 'e'], 5],
    });
  });

  test('the lot among unrated entries ignores listing order', () => {
    const forward = breaks(
      breakInput(entries, [], settings, [{ id: 'x', division: null }], {
        ratings,
        cutoff: 0,
      }),
    );
    const backward = breaks(
      breakInput(
        [...entries].reverse(),
        [],
        settings,
        [{ id: 'x', division: null }],
        { ratings, cutoff: 0 },
      ),
    );
    assert({
      given: 'the same entries listed backwards',
      should: 'seed identically',
      actual: seedsOf(backward),
      expected: seedsOf(forward),
    });
  });
});
