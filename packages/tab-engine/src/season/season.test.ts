import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { Id, ResultOf, Speakers, TwoSides } from '../shapes/competition';
import type {
  SeasonEvent,
  SeasonEventOf,
  SeasonFormula,
} from '../shapes/folds';
import {
  type Played,
  bye,
  debate,
  historyOf,
  section,
  speakers,
  twoSides,
} from '../standings/build.test-support';
import { seasonStandings } from './index';

setupRitewayBun();

const formula: SeasonFormula = {
  preliminaryWin: { points: 2, cap: null },
  eliminationRound: { points: 3 },
  bestEvents: null,
  topPerSchool: null,
};

const uncertified = (p: Played<TwoSides>): Played<TwoSides> => ({
  ...p,
  result: { ...p.result!, certified: false },
});

/** A correction of `p` that `winner` won instead. */
const correction = (p: Played<TwoSides>, winner: Id): ResultOf<TwoSides> => ({
  ...p.result!,
  id: `${p.result!.id}-fix`,
  supersedes: p.result!.id,
  outcome: { ...p.result!.outcome, winner },
});

const competitors = (
  ids: readonly Id[],
  school: (id: Id) => Id | null = () => null,
) =>
  ids.map((id) => ({
    entry: id.toLowerCase(),
    competitor: id,
    school: school(id),
  }));

const event = (
  id: Id,
  ids: readonly Id[],
  preliminary: readonly Played<TwoSides>[],
  elimination: readonly Played<TwoSides>[],
  extra: readonly ResultOf<TwoSides>[] = [],
  over: Partial<SeasonEventOf<TwoSides>> = {},
): SeasonEventOf<TwoSides> => {
  const prelim = historyOf(preliminary);
  return {
    event: id,
    sanctioned: true,
    format: twoSides,
    entries: competitors(ids),
    preliminary: { ...prelim, results: [...prelim.results, ...extra] },
    elimination: historyOf(elimination),
    ...over,
  };
};

/*
 * E1: R1 a > b, c > d; R2 a > c uncertified, b > d; R3 a > d corrected to d > a.
 * Elimination: R1 a > c with b on a bye; R2 a > b.
 * A: 1 certified win (2) + 2 rounds (6) = 8. B: 1 win (2) + bye round and
 * final (6) = 8. C: 1 win (2) + 1 round (3) = 5. D: the corrected win (2) = 2.
 */
const r3 = debate('p3a', 3, ['a', 'd'], 'a');
const e1 = event(
  'E1',
  ['A', 'B', 'C', 'D'],
  [
    debate('p1a', 1, ['a', 'b'], 'a'),
    debate('p1b', 1, ['c', 'd'], 'c'),
    uncertified(debate('p2a', 2, ['a', 'c'], 'a')),
    debate('p2b', 2, ['b', 'd'], 'b'),
    r3,
  ],
  [
    debate('x1', 1, ['a', 'c'], 'a'),
    bye('x1b', 1, 'b'),
    debate('x2', 2, ['a', 'b'], 'a'),
  ],
  [correction(r3, 'd')],
);

const table = (events: readonly SeasonEvent[], f: SeasonFormula = formula) =>
  seasonStandings(events, f).rows.map(
    (r) =>
      `${r.competitor} ${r.points} [${r.events.map((e) => `${e.event}:${e.points}`).join(' ')}]`,
  );

describe('season standings', () => {
  test('preliminary wins and elimination rounds reached', () => {
    assert({
      given: 'the event E1 worked above',
      should: 'score A 8, B 8, C 5, D 2, ordered by points then competitor id',
      actual: table([e1]),
      expected: ['A 8 [E1:8]', 'B 8 [E1:8]', 'C 5 [E1:5]', 'D 2 [E1:2]'],
    });
  });

  test('preliminary points are capped', () => {
    const e = event(
      'E2',
      ['A', 'B'],
      [1, 2, 3].map((k) => debate(`c${k}`, k, ['a', 'b'], 'a')),
      [],
    );
    assert({
      given: 'three wins at 2 points under a cap of 4',
      should: 'score 4',
      actual: table([e], { ...formula, preliminaryWin: { points: 2, cap: 4 } }),
      expected: ['A 4 [E2:4]', 'B 0 [E2:0]'],
    });
  });

  test('an unsanctioned event or an uncertified result changes nothing', () => {
    const unsanctioned = event(
      'E3',
      ['A', 'D'],
      [debate('u1', 1, ['d', 'a'], 'd')],
      [debate('u2', 1, ['d', 'a'], 'd')],
      [],
      {
        sanctioned: false,
      },
    );
    const more = {
      ...e1,
      preliminary: {
        ...e1.preliminary,
        results: [
          ...e1.preliminary.results,
          { ...debate('p4', 4, ['d', 'c'], 'd').result!, certified: false },
        ],
      },
    };
    const moreHistory = {
      ...more,
      preliminary: {
        ...more.preliminary,
        fixtures: [
          ...more.preliminary.fixtures,
          debate('p4', 4, ['d', 'c'], 'd').fixture,
        ],
      },
    };
    assert({
      given:
        'E1 beside an unsanctioned event, and E1 with one more uncertified win for D',
      should: 'give the same standings as E1 alone',
      actual: [
        seasonStandings([e1, unsanctioned], formula),
        seasonStandings([moreHistory], formula),
      ],
      expected: [
        seasonStandings([e1], formula),
        seasonStandings([e1], formula),
      ],
    });
  });

  test('a term that cannot be evaluated is an exception row', () => {
    const speech: SeasonEventOf<Speakers> = {
      event: 'S1',
      sanctioned: true,
      format: speakers,
      entries: competitors(['A', 'C']),
      preliminary: historyOf([
        section(
          'sp',
          1,
          ['a', 'c'],
          ['a', 'c'],
          [
            [
              ['a', 1, 0],
              ['c', 2, 0],
            ],
          ],
        ),
      ]),
      elimination: historyOf([
        section(
          'sx',
          1,
          ['a', 'c'],
          ['a', 'c'],
          [
            [
              ['a', 1, 0],
              ['c', 2, 0],
            ],
          ],
        ),
      ]),
    };
    const twice = event(
      'E5',
      ['B'],
      [debate('t1', 1, ['b', 'b2'], 'b')],
      [],
      [],
      {
        entries: [
          ...competitors(['B']),
          { entry: 'b2', competitor: 'B', school: null },
        ],
      },
    );
    const answer = seasonStandings([speech, twice], formula);
    assert({
      given:
        'a speech event (no winner) and a competitor entered twice in one event',
      should:
        'report each as an exception and still score the elimination round reached',
      actual: [
        answer.rows.map((r) => `${r.competitor} ${r.points}`),
        answer.exceptions,
      ],
      expected: [
        ['A 3', 'C 3', 'B 0'],
        [
          {
            competitor: 'A',
            event: 'S1',
            term: 'preliminary_win',
            reason: 'no_winner_in_format',
          },
          {
            competitor: 'C',
            event: 'S1',
            term: 'preliminary_win',
            reason: 'no_winner_in_format',
          },
          {
            competitor: 'B',
            event: 'E5',
            term: 'preliminary_win',
            reason: 'competitor_twice_in_event',
          },
          {
            competitor: 'B',
            event: 'E5',
            term: 'elimination_round',
            reason: 'competitor_twice_in_event',
          },
        ],
      ],
    });
  });

  test('the best events count, and only the top of each school is listed', () => {
    // A: E1 8, Ea 2, Eb 4. Best two: E1 and Eb = 12.
    const ea = event('Ea', ['A', 'B'], [debate('a1', 1, ['a', 'b'], 'a')], []);
    const eb = event(
      'Eb',
      ['A', 'B'],
      [debate('b1', 1, ['a', 'b'], 'a'), debate('b2', 2, ['a', 'b'], 'a')],
      [],
    );
    const schools = (id: Id) => (id === 'C' ? 'T' : 'S');
    const withSchools = (e: SeasonEventOf<TwoSides>) => ({
      ...e,
      entries: e.entries.map((x) => ({ ...x, school: schools(x.competitor) })),
    });
    assert({
      given:
        'three events for A and B, two counting; then one per school (A, B, D at S; C at T)',
      should: 'keep the best two event totals, then list only A and C',
      actual: [
        table([e1, ea, eb], { ...formula, bestEvents: 2 }),
        table([e1, ea, eb].map(withSchools), {
          ...formula,
          bestEvents: 2,
          topPerSchool: 1,
        }),
      ],
      expected: [
        ['A 12 [E1:8 Eb:4]', 'B 8 [E1:8 Ea:0]', 'C 5 [E1:5]', 'D 2 [E1:2]'],
        ['A 12 [E1:8 Eb:4]', 'C 5 [E1:5]'],
      ],
    });
  });
});
