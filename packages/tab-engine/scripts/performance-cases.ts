import { breaks } from '../src/breaks';
import { bracketFirstRound } from '../src/breaks/bracket';
import { draw } from '../src/draw';
import type {
  Entry,
  HistoricFixture,
  ResultOf,
  StageHistory,
  TwoSides,
} from '../src/shapes/competition';
import type { DrawInput, EventRequest, SlotJudge } from '../src/shapes/draw';
import type { BreaksInput } from '../src/shapes/folds';
import type { ResolvedSettings } from '../src/shapes/settings';
import { standings } from '../src/standings';
import { swissPower } from '../src/simulate/presets';
import { simulate } from '../src/simulate/run';

/**
 * The typical sizes of the plan's performance table (4.8), measured
 * single-threaded. Each figure is the best of three runs, in milliseconds.
 */
const fourTeam: ResolvedSettings = {
  ...swissPower,
  'pairing.rematch': { force: 'off' },
  'pairing.same_school': { force: 'off' },
};
const seed = new Uint8Array(32).fill(3);
const twoSides = { outcome: 'winner', sides: 2 } as const;

const field = (count: number, prefix: string): Entry[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `${prefix}${String(i).padStart(4, '0')}`,
    members: [`${prefix}-person-${i}`],
    protection: [{ scope: 'school', key: `school-${i % 12}` }],
    division: i % 4 === 0 ? 'novice' : null,
    status: 'active',
    breakEligible: true,
  }));

const pool = (count: number): SlotJudge[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `judge-${i}`,
    person: `judge-person-${i}`,
    protection: [{ scope: 'school', key: `school-${i % 12}` }],
    events: null,
    conflicts: [],
    strikes: [],
    judged: [],
    tabRoundsJudged: i % 3,
    outstandingBallots: 0,
    chair: true,
    available: true,
  }));

/** A stage history of `rounds` power rounds in which the lower id always wins. */
const history = (
  entries: readonly Entry[],
  rounds: number,
): StageHistory<TwoSides> => {
  const fixtures: HistoricFixture<TwoSides>[] = [];
  const results: ResultOf<TwoSides>[] = [];
  for (let round = 1; round <= rounds; round += 1)
    for (let i = 0; i + 1 < entries.length; i += 2) {
      const a = entries[(i + round * 3) % entries.length]!.id;
      const b = entries[(i + 1 + round * 7) % entries.length]!.id;
      if (a === b) continue;
      const id = `h${round}-${i}`;
      fixtures.push({
        id,
        tabRound: round,
        fixture: { kind: 'pairing', sides: [a, b], panel: [] },
      });
      results.push({
        id: `r${id}`,
        fixture: id,
        kind: 'decided',
        supersedes: null,
        certified: true,
        outcome: {
          kind: 'winner',
          winner: a < b ? a : b,
          ballots: [
            {
              judge: 'j',
              winner: a < b ? a : b,
              points: [
                { entry: a, points: 280 + (i % 9) },
                { entry: b, points: 279 },
              ],
            },
          ],
        },
      });
    }
  return { fixtures, results };
};

const request = (
  event: string,
  entries: readonly Entry[],
  fields: Partial<EventRequest> = {},
): EventRequest =>
  ({
    event,
    format: twoSides,
    stage: { kind: 'preliminary' },
    tabRound: 1,
    entries,
    history: { fixtures: [], results: [] },
    settings: swissPower,
    cutoff: 0,
    ratings: null,
    existing: [],
    ...fields,
  }) as EventRequest;

const best = (run: () => unknown) => {
  let least = Infinity;
  for (let i = 0; i < 3; i += 1) {
    const started = performance.now();
    run();
    least = Math.min(least, performance.now() - started);
  }
  return Math.round(least);
};

const slot = (
  events: readonly EventRequest[],
  judges: readonly SlotJudge[] | null,
): DrawInput => ({
  call: 'slot',
  slot: 'slot',
  events,
  judges,
  commitments: [],
  seed,
});

/** Each measured method with its typical target from the plan. */
export const measure = (): readonly {
  readonly method: string;
  readonly targetMs: number;
  readonly ms: number;
}[] => {
  const sixtyFour = field(64, 'a');
  const played = history(sixtyFour, 2);
  const standingsField = field(256, 's');
  const standingsHistory = history(standingsField, 8);
  const standingsInput = {
    format: twoSides,
    entries: standingsField,
    history: standingsHistory,
    settings: swissPower,
    cutoff: 8,
    ratings: null,
    division: null,
    seed,
  };
  return [
    {
      method: 'two-sided placement, 64 entries',
      targetMs: 100,
      ms: best(() =>
        draw(
          slot(
            [
              request('a', sixtyFour, {
                tabRound: 3,
                history: played,
                cutoff: 2,
              }),
            ],
            null,
          ),
        ),
      ),
    },
    {
      method: 'four-side placement, 100 teams',
      targetMs: 100,
      ms: best(() =>
        draw(
          slot(
            [
              request('b', field(100, 'b'), {
                format: { outcome: 'ranking', of: 'sides', sides: 4 },
                settings: fourTeam,
              }),
            ],
            null,
          ),
        ),
      ),
    },
    {
      method: 'sectioning, 60 speakers',
      targetMs: 100,
      ms: best(() =>
        draw(
          slot(
            [
              request('c', field(60, 'c'), {
                format: { outcome: 'ranking', of: 'speakers' },
              }),
            ],
            null,
          ),
        ),
      ),
    },
    {
      method: 'draw one slot, 3 events of 32 fixtures or fewer, 60 judges',
      targetMs: 500,
      ms: best(() =>
        draw(
          slot(
            [
              request('d1', field(40, 'd1')),
              request('d2', field(24, 'd2')),
              request('d3', field(36, 'd3'), {
                format: { outcome: 'ranking', of: 'speakers' },
              }),
            ],
            pool(60),
          ),
        ),
      ),
    },
    {
      method: 'standings, 256 entries by 8 tab rounds',
      targetMs: 50,
      ms: best(() => standings(standingsInput)),
    },
    {
      method: 'breaks, 3 stages from 256 entries',
      targetMs: 100,
      ms: best(() =>
        breaks({
          ...standingsInput,
          settings: {
            ...swissPower,
            'break.double_qualifier': { value: 'higher' },
          },
          stages: [
            { id: 'open', division: null },
            { id: 'novice', division: 'novice' },
            { id: 'third', division: null },
          ],
          choices: {},
        } as BreaksInput),
      ),
    },
    {
      method: 'seeded bracket, 1,024 entries',
      targetMs: 50,
      ms: best(() => bracketFirstRound(1024)),
    },
    {
      method: 'simulated tournament',
      targetMs: 3000,
      ms: best(() => simulate(seed, 'full')),
    },
  ];
};
