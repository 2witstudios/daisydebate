import { shuffleWith, wordStream } from '@daisy/seeded-random';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { Draw, DrawInput, RequestOf } from '../shapes/draw';
import type { StageHistory, TwoSides } from '../shapes/competition';
import { randomPreset, roundRobinPreset } from '../simulate/presets';
import { draw } from './index';
import { entriesOf, pairKey } from './facts';
import {
  drawsOf,
  entries,
  entry,
  fixturesOf,
  playTwoSided,
  request,
  seedOf,
  twoSides,
  withSettings,
} from './draw.test-support';

setupRitewayBun();

const slot = (
  requests: readonly RequestOf<TwoSides>[],
  seed = seedOf(1),
): DrawInput => ({
  call: 'slot',
  slot: 'slot-1',
  events: requests,
  judges: null,
  commitments: [],
  seed,
});

const placedOnce = (d: Draw, active: readonly string[]) => {
  const seen = fixturesOf(d).flatMap(entriesOf);
  return (
    active.every((e) => seen.filter((x) => x === e).length === 1) &&
    seen.length === active.length
  );
};

/** Plays three seeded rounds of a field and returns the history and each draw. */
const playRounds = (count: number, rounds: number, seed: number) => {
  let history: StageHistory<TwoSides> = { fixtures: [], results: [] };
  const draws: Draw[] = [];
  const field = entries(count, 4);
  for (let round = 1; round <= rounds; round += 1) {
    const d = drawsOf(
      draw(
        slot(
          [
            request(twoSides, {
              entries: field,
              tabRound: round,
              history,
              cutoff: round - 1,
            }),
          ],
          seedOf(seed + round),
        ),
      ),
    )[0]!;
    draws.push(d);
    history = playTwoSided(history, d, round, (sides) =>
      sides[0] < sides[1] ? 0 : 1,
    );
  }
  return { draws, history, field };
};

describe('two-sided draw', () => {
  test('breaks no rule, places every active entry once and gives at most one bye', () => {
    const failures: string[] = [];
    for (let seed = 0; seed < 12; seed += 1) {
      const { draws, field } = playRounds(9 + (seed % 6), 4, seed * 10);
      for (const d of draws) {
        const byes = fixturesOf(d).filter((f) => f.kind === 'bye').length;
        if (d.assessment.broken.length > 0 || d.assessment.invalid.length > 0)
          failures.push(`seed ${seed}: broke`);
        if (
          !placedOnce(
            d,
            field.map((e) => e.id),
          )
        )
          failures.push(`seed ${seed}: placement`);
        if (byes > 1) failures.push(`seed ${seed}: ${byes} byes`);
      }
    }
    assert({
      given:
        '12 seeded fields of 9 to 14 entries over four power-paired tab rounds',
      should:
        'break no rule, place every active entry once and give at most one bye',
      actual: failures,
      expected: [],
    });
  });

  test('in a powered round the bye goes to the lowest entry who has not had one', () => {
    const failures: string[] = [];
    for (let seed = 0; seed < 10; seed += 1) {
      const { draws, history } = playRounds(9 + 2 * (seed % 3), 4, seed * 7);
      draws.slice(1).forEach((d, i) => {
        const round = i + 2;
        const bye = fixturesOf(d).find((f) => f.kind === 'bye');
        if (bye === undefined || bye.kind !== 'bye') return;
        const before = history.fixtures.filter((f) => f.tabRound < round);
        const wins = (e: string) =>
          history.results.filter(
            (r) =>
              before.some((f) => f.id === r.fixture) && r.outcome.winner === e,
          ).length +
          before.filter(
            (f) => f.fixture.kind === 'bye' && f.fixture.entry === e,
          ).length;
        const hadBye = (e: string) =>
          before.some((f) => f.fixture.kind === 'bye' && f.fixture.entry === e);
        const fresh = fixturesOf(d)
          .flatMap(entriesOf)
          .filter((e) => !hadBye(e));
        if (wins(bye.entry) > Math.min(...fresh.map(wins)))
          failures.push(`seed ${seed} round ${round}`);
      });
    }
    assert({
      given: 'odd fields over four power-paired tab rounds',
      should:
        'give each bye to an entry on the fewest wins among those without a bye',
      actual: failures,
      expected: [],
    });
  });

  test('no rematch under the rematch rule, and a withdrawn entry is not placed', () => {
    const { history, field } = playRounds(10, 3, 3);
    const withdrawn = field.map((e, i) =>
      i === 0 ? { ...e, status: 'withdrawn' as const } : e,
    );
    const d = drawsOf(
      draw(
        slot([
          request(twoSides, {
            entries: withdrawn,
            tabRound: 4,
            history,
            cutoff: 3,
          }),
        ]),
      ),
    )[0]!;
    const met = new Set(
      history.fixtures.flatMap((f) =>
        f.fixture.kind === 'pairing'
          ? [pairKey(f.fixture.sides[0], f.fixture.sides[1])]
          : [],
      ),
    );
    assert({
      given: 'a fourth round after three, with one entry withdrawn',
      should: 'pair no two entries who met, and leave the withdrawn entry out',
      actual: [
        fixturesOf(d).some(
          (f) =>
            f.kind === 'pairing' && met.has(pairKey(f.sides[0], f.sides[1])),
        ),
        fixturesOf(d).flatMap(entriesOf).includes(field[0]!.id),
      ],
      expected: [false, false],
    });
  });

  test('shuffling the order of the input arrays gives the identical draw', () => {
    const { history, field } = playRounds(11, 2, 7);
    const shuffle = <T>(items: readonly T[], n: number) =>
      shuffleWith(
        items,
        wordStream('test/order', new Uint8Array([n]), new Uint8Array()),
      );
    const base = request(twoSides, {
      entries: field,
      tabRound: 3,
      history,
      cutoff: 2,
    });
    const shuffled = request(twoSides, {
      entries: shuffle(field, 1),
      tabRound: 3,
      history: {
        fixtures: shuffle(history.fixtures, 2),
        results: shuffle(history.results, 3),
      },
      cutoff: 2,
    });
    const strip = (d: Draw) =>
      JSON.stringify([d.keep, d.add, d.withdraw, d.assessment.totals]);
    assert({
      given:
        'the same round with entries, fixtures and results in another order',
      should: 'give the identical draw',
      actual: strip(drawsOf(draw(slot([shuffled])))[0]!),
      expected: strip(drawsOf(draw(slot([base])))[0]!),
    });
  });

  test('the same input twice gives equal output', () => {
    const input = slot([request(twoSides, { entries: entries(12) })]);
    assert({
      given: 'one first-round input drawn twice',
      should: 'give equal answers',
      actual: JSON.stringify(draw(input)),
      expected: JSON.stringify(draw(input)),
    });
  });
});

describe('the first tab round', () => {
  const field = entries(8);
  const ratings = {
    ladder: 'ladder-1',
    takenAt: '2026-11-01T00:00:00.000Z',
    calculation: 'glicko2-v1',
    entries: field.map((e, i) => ({
      entry: e.id,
      status: 'rated' as const,
      rating: 1800 - 50 * i,
      deviation: 60,
    })),
  };
  const seeded = withSettings({
    'pairing.method': {
      preliminary: {
        structure: 'powered',
        first: 'seeded',
        later: 'fold',
        lag: 0,
      },
      elimination: { structure: 'seeded' },
    },
    'pairing.same_school': { force: 'off' },
  });

  test('with a rating snapshot the first tab round is seeded by it', () => {
    const d = drawsOf(
      draw(
        slot([
          request(twoSides, { entries: field, settings: seeded, ratings }),
        ]),
      ),
    )[0]!;
    const pairs = fixturesOf(d)
      .map((f) =>
        entriesOf(f)
          .map((e) => field.findIndex((x) => x.id === e))
          .sort((a, b) => a - b)
          .join('v'),
      )
      .sort();
    assert({
      given: 'eight entries rated in order, drawn seeded with the fold',
      should: 'pair seed 1 with 8, 2 with 7, 3 with 6 and 4 with 5',
      actual: pairs,
      expected: ['0v7', '1v6', '2v5', '3v4'],
    });
  });

  test('without one it is random and repeatable from the seed', () => {
    const at = (seed: number) =>
      JSON.stringify(
        fixturesOf(
          drawsOf(
            draw(
              slot(
                [request(twoSides, { entries: field, settings: seeded })],
                seedOf(seed),
              ),
            ),
          )[0]!,
        ),
      );
    assert({
      given:
        'the first round with no snapshot, drawn twice with one seed and once with another',
      should: 'repeat for the same seed and differ for another',
      actual: [at(4) === at(4), at(4) === at(5)],
      expected: [true, false],
    });
  });
});

describe('windowed schedules', () => {
  const everyRound = (
    settings: typeof randomPreset,
    count: number,
    rounds: number,
  ) => {
    let history: StageHistory<TwoSides> = { fixtures: [], results: [] };
    const pairs: string[] = [];
    for (let round = 1; round <= rounds; round += 1) {
      const answer = draw({
        call: 'windowed',
        event: request(twoSides, {
          entries: entries(count, count),
          settings,
          tabRound: round,
          history,
        }),
        judges: null,
        seed: seedOf(9),
      });
      const d = drawsOf(answer)[0]!;
      for (const f of fixturesOf(d))
        if (f.kind === 'pairing') pairs.push(pairKey(f.sides[0], f.sides[1]));
      history = {
        fixtures: [
          ...history.fixtures,
          ...fixturesOf(d).map((fixture, i) => ({
            id: `w${round}-${i}`,
            tabRound: round,
            fixture: fixture as never,
          })),
        ],
        results: [],
      };
    }
    return pairs;
  };

  test('every tab round of a round robin is drawn before any result, and no pair meets twice', () => {
    const pairs = everyRound(roundRobinPreset, 7, 7);
    assert({
      given: 'seven entries and all seven tab rounds drawn with no result',
      should: 'meet every pair exactly once',
      actual: [pairs.length, new Set(pairs).size],
      expected: [21, 21],
    });
  });

  test('every tab round of a prematched stage is drawn before any result, and no pair meets twice', () => {
    const pairs = everyRound(randomPreset, 10, 5);
    assert({
      given: 'ten entries and five prematched tab rounds drawn with no result',
      should: 'give 25 pairings, none of them repeated',
      actual: [pairs.length, new Set(pairs).size],
      expected: [25, 25],
    });
  });
});

describe('a rule no plan can satisfy', () => {
  test('is infeasible, names a set where dropping any one makes a draw possible, and gives no draw', () => {
    const field = [
      entry('a', 'x'),
      entry('b', 'x'),
      entry('c', 'y'),
      entry('d', 'y'),
    ];
    const history: StageHistory<TwoSides> = {
      fixtures: [
        {
          id: 'h1',
          tabRound: 1,
          fixture: { kind: 'pairing', sides: ['a', 'c'], panel: [] },
        },
        {
          id: 'h2',
          tabRound: 1,
          fixture: { kind: 'pairing', sides: ['b', 'd'], panel: [] },
        },
        {
          id: 'h3',
          tabRound: 2,
          fixture: { kind: 'pairing', sides: ['a', 'd'], panel: [] },
        },
        {
          id: 'h4',
          tabRound: 2,
          fixture: { kind: 'pairing', sides: ['b', 'c'], panel: [] },
        },
      ],
      results: [],
    };
    const settings = withSettings({ 'pairing.same_school': { force: 'rule' } });
    const answer = draw(
      slot([
        request(twoSides, { entries: field, tabRound: 3, history, settings }),
      ]),
    );
    const relaxed = (key: 'pairing.same_school' | 'pairing.rematch') =>
      draw(
        slot([
          request(twoSides, {
            entries: field,
            tabRound: 3,
            history,
            settings: { ...settings, [key]: { force: 'off' } },
          }),
        ]),
      ).kind;
    assert({
      given:
        'two schools of two who have each met the other school, under rematch and same-school rules',
      should:
        'answer infeasible naming both rules, each of which alone unblocks a draw',
      actual: [
        answer.kind,
        answer.kind === 'infeasible' && answer.cause === 'rules'
          ? [...answer.rules].sort()
          : null,
        relaxed('pairing.same_school'),
        relaxed('pairing.rematch'),
      ],
      expected: [
        'infeasible',
        ['pairing.rematch', 'pairing.same_school'],
        'drawn',
        'drawn',
      ],
    });
  });
});

describe('a round-robin re-draw', () => {
  test('keeps the circle: a fixed fixture leaves every other fixture as scheduled', () => {
    const field = entries(8, 8);
    const at = (existing: readonly unknown[]) =>
      drawsOf(
        draw({
          call: 'windowed',
          event: request(twoSides, {
            entries: field,
            settings: roundRobinPreset,
            tabRound: 3,
            existing: existing as never,
          }),
          judges: null,
          seed: seedOf(5),
        }),
      )[0]!;
    const scheduled = at([]);
    const [pinned, ...rest] = scheduled.add;
    const redrawn = at([{ id: 'x1', fixture: pinned!.fixture, hold: 'fixed' }]);
    assert({
      given:
        'a round-robin tab round re-drawn with one of its own fixtures fixed',
      should:
        'keep that fixture and schedule every other pair exactly as before',
      actual: [
        redrawn.keep.map((k) => k.id),
        JSON.stringify(redrawn.add.map((a) => a.fixture)),
      ],
      expected: [['x1'], JSON.stringify(rest.map((a) => a.fixture))],
    });
  });

  test('a withdrawal leaves only its scheduled opponent with a bye', () => {
    const field = entries(8, 8);
    const at = (entrants: typeof field) =>
      drawsOf(
        draw({
          call: 'windowed',
          event: request(twoSides, {
            entries: entrants,
            settings: roundRobinPreset,
            tabRound: 2,
          }),
          judges: null,
          seed: seedOf(5),
        }),
      )[0]!;
    const before = at(field).add.map((a) => a.fixture);
    const dropped = before.find((f) => f.kind === 'pairing')!;
    const gone = entriesOf(dropped)[0]!;
    const after = at(
      field.map((e) =>
        e.id === gone ? { ...e, status: 'withdrawn' as const } : e,
      ),
    ).add.map((a) => a.fixture);
    assert({
      given: 'a round-robin tab round drawn again after one entry withdraws',
      should:
        "keep every other pairing and give the withdrawn entry's opponent the bye",
      actual: JSON.stringify(after),
      expected: JSON.stringify(
        before.map((f) =>
          f === dropped ? { kind: 'bye', entry: entriesOf(dropped)[1] } : f,
        ),
      ),
    });
  });
});
