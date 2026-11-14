import type {
  Entry,
  FourSides,
  HistoricFixture,
  Id,
  ResultOf,
  Speakers,
  StageHistory,
  TwoSides,
} from '../shapes/competition';
import type { Standings, StandingsInputOf } from '../shapes/folds';
import type { Metric, ResolvedSettings } from '../shapes/settings';

/** Builders for suites: small tournaments written out by hand. */

export const twoSides: TwoSides = { outcome: 'winner', sides: 2 };
export const fourSides: FourSides = {
  outcome: 'ranking',
  of: 'sides',
  sides: 4,
};
export const speakers: Speakers = { outcome: 'ranking', of: 'speakers' };

const off = { force: 'off' } as const;
export const baseSettings: ResolvedSettings = {
  'pairing.method': {
    preliminary: {
      structure: 'powered',
      first: 'random',
      later: 'fold',
      lag: 0,
    },
    elimination: { structure: 'seeded' },
  },
  'pairing.section_size': { target: 6 },
  'pairing.rematch': off,
  'pairing.same_school': off,
  'pairing.side_balance': { force: 'off', maxImbalance: 1 },
  'pairing.side_alternation': off,
  'pairing.pull_up': {
    force: 'preference',
    choose: 'least_pulled',
    maxRecordDistance: null,
  },
  'pairing.position_balance': off,
  'pairing.section_repeat': off,
  'pairing.preference_order': { order: [] },
  'bye.recipient': { value: 'lowest' },
  'bye.result': { value: 'win' },
  'bye.repeat': off,
  'judging.panel': {
    preliminary: { size: 1, decision: 'majority' },
    elimination: { size: 3, decision: 'majority' },
  },
  'judging.availability': { force: 'rule' },
  'judging.strike': off,
  'judging.conflict': { force: 'rule' },
  'judging.same_school': off,
  'judging.repeat_judge': off,
  'judging.unsubmitted_ballot': off,
  'judging.load_balance': off,
  'judging.chair': off,
  'judging.panel_same_school': off,
  'judging.preference_order': { order: [] },
  'standings.tiebreaks': {
    metrics: ['wins'],
    minimumGames: null,
    terminal: 'shared',
  },
  'break.line': { default: { kind: 'fixed', size: 4 }, byDivision: {} },
  'break.seeding': { value: 'standings' },
  'break.double_qualifier': { value: 'higher' },
};

export const withTiebreaks = (
  metrics: readonly Metric[],
  terminal: 'lot' | 'shared' = 'shared',
  minimumGames: number | null = null,
  settings: ResolvedSettings = baseSettings,
): ResolvedSettings => ({
  ...settings,
  'standings.tiebreaks': { metrics, minimumGames, terminal },
});

export const entry = (id: Id, over: Partial<Entry> = {}): Entry => ({
  id,
  members: [`${id}-member`],
  protection: [],
  division: null,
  status: 'active',
  breakEligible: true,
  ...over,
});

export type Played<F extends TwoSides | FourSides | Speakers> = {
  readonly fixture: HistoricFixture<F>;
  readonly result: ResultOf<F> | null;
};

/**
 * A two-sided debate: `winner` and one ballot per entry of `ballots`, each
 * ballot `[winner, points of side 0, points of side 1]`; one agreeing ballot
 * with the given points when none are listed.
 */
export const debate = (
  id: Id,
  tabRound: number,
  sides: readonly [Id, Id],
  winner: Id | null,
  points: readonly [number, number] = [0, 0],
  ballots: readonly (readonly [Id | null, number, number])[] = [
    [winner, ...points],
  ],
): Played<TwoSides> => ({
  fixture: { id, tabRound, fixture: { kind: 'pairing', sides, panel: [] } },
  result: {
    id: `${id}-r`,
    fixture: id,
    kind: 'decided',
    supersedes: null,
    certified: true,
    outcome: {
      kind: 'winner',
      winner,
      ballots: ballots.map(([w, a, b], i) => ({
        judge: `j${i}`,
        winner: w,
        points: [
          { entry: sides[0], points: a },
          { entry: sides[1], points: b },
        ],
      })),
    },
  },
});

export const bye = <F extends TwoSides | FourSides | Speakers>(
  id: Id,
  tabRound: number,
  of: Id,
): Played<F> => ({
  fixture: {
    id,
    tabRound,
    fixture: { kind: 'bye', entry: of },
  } as HistoricFixture<F>,
  result: null,
});

/** One judge's ranks: `[entry, rank, points]` for each entry it ranked. */
type Ranks = readonly (readonly [Id, number, number])[];

const rankingResult = (
  id: Id,
  places: readonly Id[],
  ballots: readonly Ranks[],
) => ({
  id: `${id}-r`,
  fixture: id,
  kind: 'decided' as const,
  supersedes: null,
  certified: true,
  outcome: {
    kind: 'ranking' as const,
    places: places.map((entry, i) => ({ entry, place: i + 1 })),
    ballots: ballots.map((ranks, i) => ({
      judge: `j${i}`,
      ranks: ranks.map(([entry, rank, points]) => ({ entry, rank, points })),
    })),
  },
});

/** A four-side room: `places` best first, and each judge's ranks. */
export const room = (
  id: Id,
  tabRound: number,
  sides: readonly [Id, Id, Id, Id],
  places: readonly Id[],
  ballots: readonly Ranks[],
): Played<FourSides> => ({
  fixture: { id, tabRound, fixture: { kind: 'pairing', sides, panel: [] } },
  result: rankingResult(id, places, ballots),
});

/** A speech section: speakers in order, `places` best first, and each judge's ranks. */
export const section = (
  id: Id,
  tabRound: number,
  speakerOrder: readonly Id[],
  places: readonly Id[],
  ballots: readonly Ranks[],
): Played<Speakers> => ({
  fixture: {
    id,
    tabRound,
    fixture: { kind: 'section', speakers: speakerOrder, panel: [] },
  },
  result: rankingResult(id, places, ballots),
});

export const historyOf = <F extends TwoSides | FourSides | Speakers>(
  played: readonly Played<F>[],
): StageHistory<F> => ({
  fixtures: played.map((p) => p.fixture),
  results: played.flatMap((p) => (p.result === null ? [] : [p.result])),
});

export const seed = new Uint8Array([7, 7, 7]);

export const inputOf = <F extends TwoSides | FourSides | Speakers>(
  format: F,
  entries: readonly Entry[],
  played: readonly Played<F>[],
  settings: ResolvedSettings,
  over: Partial<StandingsInputOf<F>> = {},
): StandingsInputOf<F> => ({
  format,
  entries,
  history: historyOf(played),
  settings,
  cutoff: 99,
  ratings: null,
  division: null,
  seed,
  ...over,
});

/** A row reduced to what a hand-worked table writes down. */
export const tableOf = (
  rows: readonly { entry: Id; rank: number | null; separatedBy: unknown }[],
) => rows.map((r) => `${r.rank ?? '-'} ${r.entry} ${r.separatedBy ?? '·'}`);

/** A row's values as text: `n` or `n/d`, a vector joined by commas. */
export const valuesOf = (table: Standings, id: Id) =>
  Object.fromEntries(
    (table.rows.find((r) => r.entry === id)?.values ?? []).map((v) => [
      v.metric,
      v.value.map((r) => (r.d === 1 ? `${r.n}` : `${r.n}/${r.d}`)).join(','),
    ]),
  );

/** One metric's value in one row. */
export const valueOf = (rows: Standings['rows'], id: Id, metric: string) =>
  rows.find((r) => r.entry === id)?.values.find((v) => v.metric === metric)
    ?.value;
