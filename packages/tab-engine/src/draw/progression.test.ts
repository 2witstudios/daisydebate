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
});
