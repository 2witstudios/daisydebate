import { wordStream } from '@daisy/seeded-random';
import { draw } from '../draw';
import type {
  Entry,
  Fixture,
  FormatDescriptor,
  HistoricFixture,
  Id,
  Result,
  StageHistory,
} from '../shapes/competition';
import type {
  Draw,
  DrawAnswer,
  DrawInput,
  EventRequest,
  Judge,
  SlotJudge,
} from '../shapes/draw';
import type { ResolvedSettings } from '../shapes/settings';
import { swissPower as swissPowerLike } from '../simulate/presets';

/** Builders for the checker's suites: small tournaments played through the real engine. */

export const twoSides = { outcome: 'winner', sides: 2 } as const;
export const fourSides = { outcome: 'ranking', of: 'sides', sides: 4 } as const;
export const speakers = { outcome: 'ranking', of: 'speakers' } as const;

export const numbers = (label: string, seed: number) => {
  const stream = wordStream(
    `tab-engine-checker-test/${label}`,
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

export const entry = (
  id: Id,
  school: string | null,
  members: readonly Id[] = [`${id}-p`],
): Entry => ({
  id,
  members,
  protection: school === null ? [] : [{ scope: 'school', key: school }],
  division: null,
  status: 'active',
  breakEligible: true,
});

export const judge = (
  id: Id,
  overrides: Partial<SlotJudge> = {},
): SlotJudge => ({
  id,
  person: `${id}-person`,
  protection: [],
  events: null,
  conflicts: [],
  strikes: [],
  judged: [],
  tabRoundsJudged: 0,
  outstandingBallots: 0,
  chair: true,
  available: true,
  ...overrides,
});

/** A request from the parts a suite names; the format's own generics are the suite's responsibility. */
export const request = (
  overrides: Partial<Record<keyof EventRequest, unknown>> &
    Pick<EventRequest, 'event' | 'entries' | 'settings'>,
): EventRequest =>
  ({
    format: twoSides,
    stage: { kind: 'preliminary' },
    tabRound: 1,
    history: { fixtures: [], results: [] },
    cutoff: 0,
    ratings: null,
    existing: [],
    ...overrides,
  }) as EventRequest;

export const windowed = (
  event: EventRequest,
  judges: readonly Judge[] | null,
  seed = 1,
): DrawInput => ({
  call: 'windowed',
  event,
  judges,
  seed: new Uint8Array([seed]),
});

/** A seeded outcome for one fixture, with an occasional correction that supersedes the first result. */
const resultsFor = (
  format: FormatDescriptor,
  id: Id,
  fixture: Fixture,
  next: (below: number) => number,
  doubleLoss = false,
): Result[] => {
  if (fixture.kind === 'bye') return [];
  const held = fixture.kind === 'pairing' ? fixture.sides : fixture.speakers;
  const outcome = (): Result['outcome'] => {
    if (format.outcome === 'winner')
      return {
        kind: 'winner',
        winner: doubleLoss && next(5) === 0 ? null : held[next(held.length)]!,
        ballots: [],
      };
    const order = [...held];
    for (let i = order.length - 1; i >= 1; i -= 1) {
      const j = next(i + 1);
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    return {
      kind: 'ranking',
      places: order.map((e, i) => ({ entry: e, place: i + 1 })),
      ballots: [],
    };
  };
  const first = {
    id: `r-${id}`,
    fixture: id,
    kind: 'decided',
    supersedes: null,
    certified: true,
    outcome: outcome(),
  } as Result;
  if (next(4) !== 0) return [first];
  return [
    first,
    {
      ...first,
      id: `r-${id}-fix`,
      supersedes: first.id,
      outcome: outcome(),
    } as Result,
  ];
};

/** The fixtures a drawn plan holds, under the ids history will know them by. */
const historicOf = (d: Draw): HistoricFixture<FormatDescriptor>[] =>
  [
    ...d.keep.map((k) => ({
      id: k.id,
      tabRound: d.tabRound,
      fixture: k.fixture,
    })),
    ...d.add.map((a) => ({
      id: `${d.event}-t${d.tabRound}-${a.ordinal}`,
      tabRound: d.tabRound,
      fixture: a.fixture,
    })),
  ] as HistoricFixture<FormatDescriptor>[];

export type Played = { readonly input: DrawInput; readonly answer: DrawAnswer };

/** Plays `rounds` tab rounds of one windowed event, drawing each with the engine. */
export const playEvent = (options: {
  readonly label: string;
  readonly seed: number;
  readonly format: FormatDescriptor;
  readonly entries: readonly Entry[];
  readonly settings: ResolvedSettings;
  readonly judges: readonly Judge[] | null;
  readonly rounds: number;
}): Played[] => {
  const next = numbers(options.label, options.seed);
  const played: Played[] = [];
  let history: StageHistory<FormatDescriptor> = { fixtures: [], results: [] };
  let judges = options.judges;
  for (let tabRound = 1; tabRound <= options.rounds; tabRound += 1) {
    const input = windowed(
      request({
        event: 'ev',
        format: options.format as EventRequest['format'],
        entries: options.entries,
        settings: options.settings,
        tabRound,
        cutoff: tabRound - 1,
        history: history as EventRequest['history'],
      }),
      judges,
      options.seed,
    );
    const answer = draw(input);
    played.push({ input, answer });
    if (answer.kind !== 'drawn') break;
    const fixtures = historicOf(answer.draws[0]!);
    history = {
      fixtures: [...history.fixtures, ...fixtures],
      results: [
        ...history.results,
        ...fixtures.flatMap((f) =>
          resultsFor(options.format, f.id, f.fixture, next),
        ),
      ],
    } as StageHistory<FormatDescriptor>;
    const seated = new Map(
      fixtures.flatMap((f) =>
        f.fixture.kind === 'bye'
          ? []
          : f.fixture.panel.map((j) => [j, f.fixture] as const),
      ),
    );
    judges =
      judges?.map((j) => {
        const sat = seated.get(j.id);
        if (sat === undefined || sat.kind === 'bye') return j;
        const held = sat.kind === 'pairing' ? sat.sides : sat.speakers;
        return {
          ...j,
          tabRoundsJudged: j.tabRoundsJudged + 1,
          judged: [...j.judged, ...held],
        };
      }) ?? null;
  }
  return played;
};

export const drawnOf = (answer: DrawAnswer): readonly Draw[] => {
  if (answer.kind !== 'drawn')
    throw new Error(`expected a drawn answer, got ${answer.kind}`);
  return answer.draws;
};

export const sharedPerson = 'shared-person';

/**
 * A slot with a debate and a speech event, beside a commitment holding one
 * judge and someone from elsewhere. With `share`, a debater is also a speaker.
 */
export const slotCase = (
  options: {
    readonly share?: boolean;
    readonly commitmentPeople?: readonly Id[];
  } = {},
): DrawInput => ({
  call: 'slot',
  slot: 'slot-1',
  events: [
    request({
      event: 'debate',
      entries: [
        entry(
          'd0',
          's0',
          options.share === true ? ['d0-p', sharedPerson] : ['d0-p'],
        ),
        entry('d1', 's1'),
        entry('d2', 's1'),
        entry('d3', 's2'),
        entry('d4', null),
      ],
      settings: swissPowerLike,
    }),
    request({
      event: 'speech',
      format: speakers,
      entries: [
        entry('x0', 's0', [sharedPerson]),
        entry('x1', 's1'),
        entry('x2', 's2'),
        entry('x3', null),
        entry('x4', 's1'),
      ],
      settings: { ...swissPowerLike, 'pairing.section_size': { target: 5 } },
    }),
  ],
  judges: [
    judge('j0'),
    judge('j1'),
    judge('j2', { available: false }),
    judge('j3'),
    judge('j4'),
  ],
  commitments: [
    {
      event: 'other',
      fixture: 'other-1',
      people: options.commitmentPeople ?? ['j4-person', 'outsider'],
    },
  ],
  seed: new Uint8Array([3]),
});

/**
 * Plays an elimination stage of one windowed event from its bracket, drawing
 * each tab round with the engine until it stops drawing or `rounds` is
 * reached. With `doubleLoss`, a two-sided result is now and then a loss to both.
 */
export const playBracket = (options: {
  readonly label: string;
  readonly seed: number;
  readonly format: FormatDescriptor;
  readonly entries: readonly Entry[];
  readonly settings: ResolvedSettings;
  readonly judges: readonly Judge[] | null;
  readonly rounds: number;
  readonly doubleLoss?: boolean;
}): Played[] => {
  const next = numbers(options.label, options.seed);
  const played: Played[] = [];
  let history: StageHistory<FormatDescriptor> = { fixtures: [], results: [] };
  for (let tabRound = 1; tabRound <= options.rounds; tabRound += 1) {
    const input = windowed(
      request({
        event: 'ev',
        format: options.format as EventRequest['format'],
        stage: {
          kind: 'elimination',
          division: null,
          bracket: { seeds: options.entries.map((e) => e.id) },
        },
        entries: options.entries,
        settings: options.settings,
        tabRound,
        cutoff: tabRound - 1,
        history: history as EventRequest['history'],
      }),
      options.judges,
      options.seed,
    );
    const answer = draw(input);
    played.push({ input, answer });
    if (answer.kind !== 'drawn') break;
    const fixtures = historicOf(answer.draws[0]!);
    if (fixtures.length === 0) break;
    history = {
      fixtures: [...history.fixtures, ...fixtures],
      results: [
        ...history.results,
        ...fixtures.flatMap((f) =>
          resultsFor(
            options.format,
            f.id,
            f.fixture,
            next,
            options.doubleLoss === true,
          ),
        ),
      ],
    } as StageHistory<FormatDescriptor>;
  }
  return played;
};
