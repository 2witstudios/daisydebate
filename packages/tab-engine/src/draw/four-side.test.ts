import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type {
  FourSides,
  HistoricFixture,
  StageHistory,
} from '../shapes/competition';
import { draw } from './index';
import { entriesOf } from './facts';
import {
  drawsOf,
  entries,
  fixturesOf,
  fourSides,
  request as anyRequest,
  seedOf,
  withSettings,
} from './draw.test-support';

/** The dominant four-team rules weigh neither school nor prior meetings. */
const fourTeam = withSettings({
  'pairing.rematch': { force: 'off' },
  'pairing.same_school': { force: 'off' },
});
const request: typeof anyRequest = (format, fields = {}) =>
  anyRequest(format, { settings: fourTeam, ...fields });

setupRitewayBun();

const permutations = <T>(items: readonly T[]): T[][] =>
  items.length <= 1
    ? [[...items]]
    : items.flatMap((x, i) =>
        permutations(items.filter((_, j) => j !== i)).map((rest) => [
          x,
          ...rest,
        ]),
      );

describe('four-side draw', () => {
  const field = entries(8, 8);
  const ids = field.map((e) => e.id);
  /** Round 1 seated everyone; with no result counted, the whole field is one pool of 8. */
  const history: StageHistory<FourSides> = {
    fixtures: [
      {
        id: 'h1',
        tabRound: 1,
        fixture: {
          kind: 'pairing',
          sides: [ids[0]!, ids[1]!, ids[2]!, ids[3]!],
          panel: [],
        },
      },
      {
        id: 'h2',
        tabRound: 1,
        fixture: {
          kind: 'pairing',
          sides: [ids[4]!, ids[5]!, ids[6]!, ids[7]!],
          panel: [],
        },
      },
    ] as HistoricFixture<FourSides>[],
    results: [],
  };
  const squares = (positions: ReadonlyMap<string, number>) =>
    ids.reduce((sum, team) => {
      const before = history.fixtures
        .flatMap((f) =>
          f.fixture.kind === 'pairing' ? [f.fixture.sides.indexOf(team)] : [],
        )
        .filter((p) => p >= 0);
      const counts = [0, 1, 2, 3].map(
        (p) =>
          before.filter((x) => x === p).length +
          (positions.get(team) === p ? 1 : 0),
      );
      return sum + counts.reduce((s, c) => s + c * c, 0);
    }, 0);

  test('no other assignment of positions in the pool gives a lower sum of squared position counts', () => {
    const d = drawsOf(
      draw({
        call: 'windowed',
        event: request(fourSides, { entries: field, tabRound: 2, history }),
        judges: null,
        seed: seedOf(2),
      }),
    )[0]!;
    const drawn = new Map(
      fixturesOf(d).flatMap((f) =>
        f.kind === 'pairing' ? f.sides.map((t, p) => [t, p] as const) : [],
      ),
    );
    let best = Infinity;
    for (const order of permutations(ids)) {
      const counts = new Map(order.map((team, i) => [team, i % 4]));
      best = Math.min(best, squares(counts));
      if (best === 16) break;
    }
    assert({
      given: 'eight teams in one pool, each having held one position',
      should:
        'reach the least sum of squared position counts any assignment can',
      actual: squares(drawn),
      expected: best,
    });
  });

  test('fixtures stay within point pools', () => {
    const field16 = entries(16, 16);
    const rooms = drawsOf(
      draw({
        call: 'windowed',
        event: request(fourSides, { entries: field16 }),
        judges: null,
        seed: seedOf(3),
      }),
    )[0]!;
    const played: StageHistory<FourSides> = {
      fixtures: fixturesOf(rooms).map((fixture, i) => ({
        id: `r1-${i}`,
        tabRound: 1,
        fixture: fixture as never,
      })),
      results: fixturesOf(rooms).map((fixture, i) => ({
        id: `res-${i}`,
        fixture: `r1-${i}`,
        kind: 'decided',
        supersedes: null,
        certified: true,
        outcome: {
          kind: 'ranking',
          places: entriesOf(fixture).map((entry, p) => ({
            entry,
            place: p + 1,
          })),
          ballots: [],
        },
      })),
    };
    const points = new Map(
      played.results.flatMap((r) =>
        r.outcome.kind === 'ranking'
          ? r.outcome.places.map((p) => [p.entry, 4 - p.place] as const)
          : [],
      ),
    );
    const next = drawsOf(
      draw({
        call: 'windowed',
        event: request(fourSides, {
          entries: field16,
          tabRound: 2,
          history: played,
          cutoff: 1,
        }),
        judges: null,
        seed: seedOf(4),
      }),
    )[0]!;
    assert({
      given:
        'sixteen teams after one round, four on each of 3, 2, 1 and 0 points',
      should: 'seat each room with four teams on equal points',
      actual: fixturesOf(next).map(
        (f) => new Set(entriesOf(f).map((e) => points.get(e))).size,
      ),
      expected: [1, 1, 1, 1],
    });
  });

  test('an entry left over from the fours takes a bye', () => {
    const d = drawsOf(
      draw({
        call: 'windowed',
        event: request(fourSides, { entries: entries(10, 10) }),
        judges: null,
        seed: seedOf(5),
      }),
    )[0]!;
    assert({
      given: 'ten teams',
      should: 'make two rooms of four and two byes',
      actual: fixturesOf(d)
        .map((f) => f.kind)
        .sort(),
      expected: ['bye', 'bye', 'pairing', 'pairing'],
    });
  });
});
