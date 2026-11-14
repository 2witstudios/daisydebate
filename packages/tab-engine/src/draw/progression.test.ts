import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { StageHistory, TwoSides } from '../shapes/competition';
import { draw } from './index';
import { entriesOf } from './facts';
import {
  drawsOf,
  entries,
  fixturesOf,
  playTwoSided,
  request,
  seedOf,
  twoSides,
  withSettings,
} from './draw.test-support';

setupRitewayBun();

describe('bracket progression', () => {
  const field = entries(13, 13);
  const seeds = field.map((e) => e.id);
  const stage = {
    kind: 'elimination',
    division: null,
    bracket: { seeds },
  } as const;
  const seedNumber = (id: string) => seeds.indexOf(id) + 1;
  const elimination = (tabRound: number, history: StageHistory<TwoSides>) =>
    drawsOf(
      draw({
        call: 'windowed',
        event: request(twoSides, { entries: field, stage, tabRound, history }),
        judges: null,
        seed: seedOf(1),
      }),
    )[0]!;
  const higherSeedWins = (sides: readonly [string, string]) =>
    seedNumber(sides[0]) < seedNumber(sides[1]) ? 0 : 1;

  test('the first tab round gives the top seeds byes and pairs the rest by the standard tree', () => {
    const first = elimination(1, { fixtures: [], results: [] });
    assert({
      given: 'a bracket of thirteen',
      should:
        'give seeds 1, 2 and 3 byes and pair 8-9, 5-12, 4-13, 6-11 and 7-10',
      actual: fixturesOf(first).map((f) =>
        entriesOf(f).map(seedNumber).join('-'),
      ),
      expected: ['1', '8-9', '5-12', '4-13', '3', '6-11', '7-10', '2'],
    });
  });

  test('each later tab round follows from the bracket and the results before it', () => {
    const first = elimination(1, { fixtures: [], results: [] });
    const afterFirst = playTwoSided(
      { fixtures: [], results: [] },
      first,
      1,
      higherSeedWins,
    );
    const second = elimination(2, afterFirst);
    const afterSecond = playTwoSided(afterFirst, second, 2, higherSeedWins);
    const third = elimination(3, afterSecond);
    assert({
      given: 'a bracket of thirteen in which the higher seed always wins',
      should: 'meet 1-8, 4-5, 3-6 and 2-7, then 1-4 and 2-3',
      actual: [second, third].map((d) =>
        fixturesOf(d).map((f) => entriesOf(f).map(seedNumber).join('-')),
      ),
      expected: [
        ['1-8', '4-5', '3-6', '2-7'],
        ['1-4', '2-3'],
      ],
    });
  });

  test('a missing result is named, not guessed', () => {
    const first = elimination(1, { fixtures: [], results: [] });
    const played = playTwoSided(
      { fixtures: [], results: [] },
      first,
      1,
      higherSeedWins,
    );
    const answer = draw({
      call: 'windowed',
      event: request(twoSides, {
        entries: field,
        stage,
        tabRound: 2,
        history: {
          fixtures: played.fixtures,
          results: played.results.slice(1),
        },
      }),
      judges: null,
      seed: seedOf(1),
    });
    assert({
      given: 'the second tab round with one first-round result missing',
      should: 'answer infeasible on the missing result',
      actual:
        answer.kind === 'infeasible' && answer.cause === 'structure'
          ? answer.fact
          : answer.kind,
      expected: 'missing_result',
    });
  });

  test('a double loss keeps its bracket place, and the survivor of that pair takes a bye', () => {
    const eight = entries(8, 8);
    const seeds8 = eight.map((e) => e.id);
    const stage8 = {
      kind: 'elimination',
      division: null,
      bracket: { seeds: seeds8 },
    } as const;
    const at = (tabRound: number, history: StageHistory<TwoSides>) =>
      drawsOf(
        draw({
          call: 'windowed',
          event: request(twoSides, {
            entries: eight,
            stage: stage8,
            tabRound,
            history,
          }),
          judges: null,
          seed: seedOf(1),
        }),
      )[0]!;
    const first = at(1, { fixtures: [], results: [] });
    const played = playTwoSided(
      { fixtures: [], results: [] },
      first,
      1,
      (sides) => (seeds8.indexOf(sides[0]) < seeds8.indexOf(sides[1]) ? 0 : 1),
    );
    const doubleLoss = {
      ...played,
      results: played.results.map((r, i) =>
        i === 0 ? { ...r, outcome: { ...r.outcome, winner: null } } : r,
      ),
    };
    const n = (id: string) => seeds8.indexOf(id) + 1;
    assert({
      given: 'eight seeds where 1 and 8 both lose',
      should:
        'give seed 4 a bye in the place 1-8 would have filled, and pair 2 with 3',
      actual: fixturesOf(at(2, doubleLoss)).map((f) =>
        entriesOf(f).map(n).join('-'),
      ),
      expected: ['4', '3-2'].map((x) =>
        x
          .split('-')
          .map(Number)
          .sort((a, b) => a - b)
          .join('-'),
      ),
    });
  });

  test('no pairing policy applies to an elimination round: the bracket fixes it', () => {
    const schoolmates = entries(4, 1);
    const d = drawsOf(
      draw({
        call: 'windowed',
        event: request(twoSides, {
          entries: schoolmates,
          stage: {
            kind: 'elimination',
            division: null,
            bracket: { seeds: schoolmates.map((e) => e.id) },
          },
          settings: withSettings({ 'pairing.same_school': { force: 'rule' } }),
        }),
        judges: null,
        seed: seedOf(1),
      }),
    )[0]!;
    assert({
      given:
        'four entries of one school in a bracket, under a same-school rule',
      should: 'draw the bracket and report no pairing policy broken',
      actual: [fixturesOf(d).length, d.assessment.broken],
      expected: [2, []],
    });
  });
});
