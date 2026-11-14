import { shuffleWith, wordStream } from '@daisy/seeded-random';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { Entry, ResultOf, TwoSides } from '../shapes/competition';
import type { StandingsInputOf } from '../shapes/folds';
import type { Metric } from '../shapes/settings';
import {
  type Played,
  bye,
  debate,
  entry,
  inputOf,
  twoSides,
  withTiebreaks,
} from './build.test-support';
import { standings } from './index';

setupRitewayBun();

const numbers = (label: string, seed: number) => {
  const stream = wordStream(
    `tab-engine-test/${label}`,
    new Uint8Array([seed]),
    new Uint8Array(),
  );
  let at = 0;
  return (below: number) => {
    const word = stream(at);
    at += 1;
    return word % below;
  };
};
const permute = <T>(items: readonly T[], label: string, seed: number) =>
  shuffleWith(
    items,
    wordStream(
      `tab-engine-test/${label}`,
      new Uint8Array([seed]),
      new Uint8Array(),
    ),
  );

const metricsPool: Metric[] = [
  'wins',
  'total_points',
  'high_low_points',
  'opponent_wins',
  'ballot_count',
  'win_percentage',
];

/** A seeded two-sided tournament: random pairings, byes, panels and points. */
const tournament = (seed: number) => {
  const next = numbers('standings-props', seed);
  const ids = Array.from({ length: 4 + next(6) }, (_, i) => `e${i}`);
  const entries: Entry[] = ids.map((id) =>
    entry(id, { division: next(2) === 0 ? 'a' : 'b' }),
  );
  const played: Played<TwoSides>[] = [];
  const rounds = 1 + next(4);
  for (let round = 1; round <= rounds; round += 1) {
    const order = permute(ids, `round-${round}`, seed);
    if (order.length % 2 === 1)
      played.push(bye(`r${round}-bye`, round, order.pop()!));
    for (let i = 0; i < order.length; i += 2) {
      const sides = [order[i]!, order[i + 1]!] as const;
      const ballots = Array.from(
        { length: 1 + 2 * next(2) },
        () => [sides[next(2)]!, 25 + next(6), 25 + next(6)] as const,
      );
      played.push(
        debate(
          `r${round}-${i}`,
          round,
          sides,
          sides[next(2)]!,
          [0, 0],
          ballots,
        ),
      );
    }
  }
  const metrics = permute(metricsPool, 'metrics', seed).slice(0, 1 + next(4));
  const settings = withTiebreaks(
    metrics,
    next(2) === 0 ? 'lot' : 'shared',
    next(3) === 0 ? 2 : null,
  );
  return { entries, played, settings, rounds, next };
};

const rowsKey = (input: StandingsInputOf<TwoSides>) =>
  JSON.stringify(standings(input));

describe('standings properties', () => {
  test('the order of results, fixtures and entries changes nothing', () => {
    const failures: number[] = [];
    for (let seed = 0; seed < 120; seed += 1) {
      const { entries, played, settings } = tournament(seed);
      const input = inputOf(twoSides, entries, played, settings);
      const shuffled: StandingsInputOf<TwoSides> = {
        ...input,
        entries: permute(entries, 'entries', seed),
        history: {
          fixtures: permute(input.history.fixtures, 'fixtures', seed),
          results: permute(input.history.results, 'results', seed),
        },
      };
      if (rowsKey(input) !== rowsKey(shuffled)) failures.push(seed);
    }
    assert({
      given: '120 seeded tournaments, each listed in a shuffled order',
      should: 'give identical standings',
      actual: failures,
      expected: [],
    });
  });

  test('a division’s rows are the event’s rows with the other divisions removed', () => {
    const failures: number[] = [];
    for (let seed = 0; seed < 120; seed += 1) {
      const { entries, played, settings } = tournament(seed);
      // A lot is drawn over the tied group, which a division narrows, so the property is stated for shared ties.
      const shared = {
        ...settings,
        'standings.tiebreaks': {
          ...settings['standings.tiebreaks'],
          terminal: 'shared' as const,
        },
      };
      const event = standings(inputOf(twoSides, entries, played, shared));
      const divisionOf = new Map(entries.map((e) => [e.id, e.division]));
      for (const division of ['a', 'b']) {
        const rows = standings(
          inputOf(twoSides, entries, played, shared, { division }),
        ).rows.map((r) => r.entry);
        const expected = event.rows
          .map((r) => r.entry)
          .filter((id) => divisionOf.get(id) === division);
        if (rows.join() !== expected.join()) failures.push(seed);
      }
    }
    assert({
      given: '120 seeded tournaments in two divisions',
      should: 'order each division as the event orders it',
      actual: failures,
      expected: [],
    });
  });

  test('a correction to a round after the cutoff changes nothing', () => {
    const failures: number[] = [];
    for (let seed = 0; seed < 120; seed += 1) {
      const { entries, played, settings, rounds } = tournament(seed);
      const cutoff = rounds - 1;
      const input = inputOf(twoSides, entries, played, settings, { cutoff });
      const late = played.flatMap((p) =>
        p.fixture.tabRound > cutoff && p.result !== null ? [p.result] : [],
      );
      const corrections: ResultOf<TwoSides>[] = late.map((r) => ({
        ...r,
        id: `${r.id}-fix`,
        supersedes: r.id,
        outcome: { ...r.outcome, winner: null },
      }));
      const corrected = {
        ...input,
        history: {
          ...input.history,
          results: [...input.history.results, ...corrections],
        },
      };
      if (rowsKey(input) !== rowsKey(corrected)) failures.push(seed);
    }
    assert({
      given:
        '120 seeded tournaments with every last-round result corrected, cut off before that round',
      should: 'give identical standings',
      actual: failures,
      expected: [],
    });
  });

  test('the latest correction counts and a superseded result does not', () => {
    const failures: number[] = [];
    for (let seed = 0; seed < 120; seed += 1) {
      const { entries, played, settings, next } = tournament(seed);
      const decided = played.flatMap((p) =>
        p.result === null ? [] : [p.result],
      );
      const target = decided[next(decided.length)]!;
      const flip = (
        r: ResultOf<TwoSides>,
        id: string,
        supersedes: string | null,
      ): ResultOf<TwoSides> => ({
        ...r,
        id,
        supersedes,
        outcome: {
          ...r.outcome,
          winner: null,
          ballots: r.outcome.ballots.map((b) => ({ ...b, winner: null })),
        },
      });
      const first = flip(target, `${target.id}-c1`, target.id);
      const second: ResultOf<TwoSides> = {
        ...target,
        id: `${target.id}-c2`,
        supersedes: first.id,
      };
      const chained = inputOf(twoSides, entries, played, settings);
      const withChain = {
        ...chained,
        history: {
          ...chained.history,
          results: [...chained.history.results, second, first],
        },
      };
      const replaced = {
        ...chained,
        history: {
          ...chained.history,
          results: chained.history.results.map((r) =>
            r.id === target.id ? second : r,
          ),
        },
      };
      const a = standings(withChain);
      const b = standings(replaced);
      const counted =
        a.results.includes(second.id) &&
        !a.results.includes(first.id) &&
        !a.results.includes(target.id);
      if (JSON.stringify(a) !== JSON.stringify(b) || !counted)
        failures.push(seed);
    }
    assert({
      given:
        '120 seeded tournaments with one result corrected twice, the middle correction a double loss',
      should: 'count only the latest correction, as if it were the only result',
      actual: failures,
      expected: [],
    });
  });
});
