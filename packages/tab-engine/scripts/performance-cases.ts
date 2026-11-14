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
import type { Scenario } from '../src/simulate/scenario';

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

/** One run, for a case too long to repeat in the suite. */
const once = (run: () => unknown) => {
  const started = performance.now();
  run();
  return Math.round(performance.now() - started);
};

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

type Row = {
  readonly method: string;
  readonly targetMs: number;
  readonly ms: number;
};

/** A four-side or speech request at tab round 2, after a first round seated and unplayed. */
const secondRound = (event: EventRequest): EventRequest => {
  const first = draw(slot([event], null));
  const fixtures =
    first.kind === 'drawn'
      ? [
          ...first.draws[0]!.add.map((a, i) => ({
            id: `r1-${i}`,
            tabRound: 1,
            fixture: a.fixture,
          })),
        ]
      : [];
  return {
    ...event,
    tabRound: 2,
    history: { fixtures, results: [] },
  } as EventRequest;
};

/** Every fixture of the slot fixed with an empty panel: judges are seated, nothing else. */
const judgesOnly = (
  events: readonly EventRequest[],
  judges: readonly SlotJudge[],
): DrawInput => {
  const placed = draw(slot(events, null));
  if (placed.kind !== 'drawn') return slot(events, judges);
  return slot(
    events.map((e) => {
      const d = placed.draws.find((x) => x.event === e.event)!;
      return {
        ...e,
        existing: d.add.map((a, i) => ({
          id: `${e.event}-${i}`,
          fixture: a.fixture,
          hold: 'fixed',
        })),
      } as EventRequest;
    }),
    judges,
  );
};

const twoSidedEvents = (count: number, size: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `ev${i}`,
    format: twoSides,
    entries: size,
    settings: swissPower,
    divisions: false,
    windowed: false,
  }));

/** The stated simulated tournament: three events of 64 sharing slots, six tab rounds and a break. */
const statedTournament = (): Scenario => ({
  events: twoSidedEvents(3, 64),
  schools: 8,
  preliminaryRounds: 6,
  together: true,
  drops: true,
  lateResults: false,
  corrections: true,
  redraws: false,
  personInTwoEvents: false,
  unsubmittedBallots: true,
  doubleQualifier: 'higher',
});

/** The plan's typical sizes (4.8), measured in the suite. */
export const measure = (): readonly Row[] => {
  const sixtyFour = field(64, 'a');
  const played = history(sixtyFour, 2);
  const standingsField = field(256, 's');
  const standingsInput = {
    format: twoSides,
    entries: standingsField,
    history: history(standingsField, 8),
    settings: swissPower,
    cutoff: 8,
    ratings: null,
    division: null,
    seed,
  };
  const four = request('b', field(100, 'b'), {
    format: { outcome: 'ranking', of: 'sides', sides: 4 },
    settings: fourTeam,
  });
  const speech = request('c', field(60, 'c'), {
    format: { outcome: 'ranking', of: 'speakers' },
  });
  const threeEvents = [
    request('d1', field(40, 'd1')),
    request('d2', field(24, 'd2')),
    request('d3', field(36, 'd3'), {
      format: { outcome: 'ranking', of: 'speakers' },
    }),
  ];
  const fourAgain = secondRound(four);
  const speechAgain = secondRound(speech);
  const judgeSlot = judgesOnly(
    [
      request('j1', field(30, 'j1')),
      request('j2', field(26, 'j2')),
      request('j3', field(24, 'j3')),
    ],
    pool(60),
  );
  return [
    {
      method: 'two-sided placement, 64 entries, tab round 3',
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
      method: 'four-side placement, 100 teams, tab round 2',
      targetMs: 100,
      ms: best(() => draw(slot([fourAgain], null))),
    },
    {
      method: 'sectioning, 60 speakers, tab round 2',
      targetMs: 100,
      ms: best(() => draw(slot([speechAgain], null))),
    },
    {
      method:
        'judge assignment alone, one slot: 3 events, 40 fixtures, 60 judges, single judges',
      targetMs: 150,
      ms: best(() => draw(judgeSlot)),
    },
    {
      method: 'draw one slot, 3 events of 32 fixtures or fewer, 60 judges',
      targetMs: 500,
      ms: best(() => draw(slot(threeEvents, pool(60)))),
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
      method:
        'simulated tournament: 3 events of 64 sharing slots, 6 tab rounds and a break',
      targetMs: 3000,
      ms: once(() => simulate(seed, 'full', statedTournament())),
    },
  ];
};

/** The plan's large and ceiling sizes, measured once by the long run (they gate nothing). */
export const measureLarge = (): readonly Row[] => {
  const field256 = field(256, 'l');
  const field512 = field(512, 'm');
  const field1000 = field(1000, 'n');
  const sixEvents = Array.from({ length: 6 }, (_, i) =>
    request(`s${i}`, field(50, `s${i}`)),
  );
  return [
    {
      method: 'two-sided placement, 256 entries, tab round 3',
      targetMs: 1000,
      ms: best(() =>
        draw(
          slot(
            [
              request('l', field256, {
                tabRound: 3,
                history: history(field256, 2),
                cutoff: 2,
              }),
            ],
            null,
          ),
        ),
      ),
    },
    {
      method: 'two-sided placement, 512 entries, tab round 3 (ceiling)',
      targetMs: 8000,
      ms: best(() =>
        draw(
          slot(
            [
              request('m', field512, {
                tabRound: 3,
                history: history(field512, 2),
                cutoff: 2,
              }),
            ],
            null,
          ),
        ),
      ),
    },
    {
      method: 'four-side placement, 400 teams, tab round 2',
      targetMs: 1000,
      ms: best(() =>
        draw(
          slot(
            [
              secondRound(
                request('f', field(400, 'f'), {
                  format: { outcome: 'ranking', of: 'sides', sides: 4 },
                  settings: fourTeam,
                }),
              ),
            ],
            null,
          ),
        ),
      ),
    },
    {
      method: 'sectioning, 300 speakers, tab round 2',
      targetMs: 2000,
      ms: best(() =>
        draw(
          slot(
            [
              secondRound(
                request('g', field(300, 'g'), {
                  format: { outcome: 'ranking', of: 'speakers' },
                }),
              ),
            ],
            null,
          ),
        ),
      ),
    },
    {
      method: 'draw one slot, 6 events, 150 fixtures, 300 judges',
      targetMs: 5000,
      ms: best(() => draw(slot(sixEvents, pool(300)))),
    },
    {
      method:
        "judge assignment alone, 6 events, 150 fixtures, panels of 3, 500 judges (450 seats: the plan's 300 judges cannot fill them)",
      targetMs: 3000,
      ms: best(() =>
        draw(
          judgesOnly(
            sixEvents.map(
              (e) =>
                ({
                  ...e,
                  settings: {
                    ...swissPower,
                    'judging.panel': {
                      ...swissPower['judging.panel'],
                      preliminary: { size: 3, decision: 'majority' },
                    },
                  },
                }) as EventRequest,
            ),
            pool(500),
          ),
        ),
      ),
    },
    {
      method: 'standings, 1,000 entries by 8 tab rounds',
      targetMs: 300,
      ms: best(() =>
        standings({
          format: twoSides,
          entries: field1000,
          history: history(field1000, 8),
          settings: swissPower,
          cutoff: 8,
          ratings: null,
          division: null,
          seed,
        }),
      ),
    },
  ];
};
