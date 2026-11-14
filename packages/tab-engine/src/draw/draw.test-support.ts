import type {
  Entry,
  FormatDescriptor,
  HistoricFixture,
  ResultOf,
  StageHistory,
  TwoSides,
} from '../shapes/competition';
import type { Draw, DrawAnswer, RequestOf, SlotJudge } from '../shapes/draw';
import type { ResolvedSettings } from '../shapes/settings';
import { swissPower } from '../simulate/presets';

export const twoSides = { outcome: 'winner', sides: 2 } as const;
export const fourSides = { outcome: 'ranking', of: 'sides', sides: 4 } as const;
export const speakers = { outcome: 'ranking', of: 'speakers' } as const;

export const seedOf = (n: number) => new Uint8Array(32).fill(n);

export const entry = (
  id: string,
  school: string | null = null,
  extra: Partial<Entry> = {},
): Entry => ({
  id,
  members: [`person-${id}`],
  protection: school === null ? [] : [{ scope: 'school', key: school }],
  division: null,
  status: 'active',
  breakEligible: true,
  ...extra,
});

export const entries = (count: number, schools = count, prefix = 'e') =>
  Array.from({ length: count }, (_, i) =>
    entry(`${prefix}${String(i).padStart(2, '0')}`, `s${i % schools}`),
  );

export const judge = (
  id: string,
  extra: Partial<SlotJudge> = {},
): SlotJudge => ({
  id,
  person: `person-${id}`,
  protection: [],
  events: null,
  conflicts: [],
  strikes: [],
  judged: [],
  tabRoundsJudged: 0,
  outstandingBallots: 0,
  chair: true,
  available: true,
  ...extra,
});

export const judges = (count: number, prefix = 'j') =>
  Array.from({ length: count }, (_, i) =>
    judge(`${prefix}${String(i).padStart(2, '0')}`),
  );

export const emptyHistory = { fixtures: [], results: [] } as const;

export const request = <Format extends FormatDescriptor>(
  format: Format,
  fields: Partial<RequestOf<Format>> = {},
): RequestOf<Format> =>
  ({
    event: 'ev',
    format,
    stage: { kind: 'preliminary' },
    tabRound: 1,
    entries: entries(8),
    history: emptyHistory,
    settings: swissPower,
    cutoff: 0,
    ratings: null,
    existing: [],
    ...fields,
  }) as RequestOf<Format>;

export const drawsOf = (answer: DrawAnswer): readonly Draw[] => {
  if (answer.kind !== 'drawn')
    throw new Error(`expected a draw, got ${answer.kind}`);
  return answer.draws;
};

export const fixturesOf = (draw: Draw) => [
  ...draw.keep.map((k) => k.fixture),
  ...draw.add.map((a) => a.fixture),
];

/** Plays a two-sided tab round: the first side wins, by fixed points. */
export const playTwoSided = (
  history: StageHistory<TwoSides>,
  draw: Draw,
  tabRound: number,
  winner: (sides: readonly [string, string]) => 0 | 1 = () => 0,
): StageHistory<TwoSides> => {
  const fixtures: HistoricFixture<TwoSides>[] = fixturesOf(draw).map(
    (fixture, i) => ({
      id: `f${tabRound}-${i}`,
      tabRound,
      fixture: fixture as HistoricFixture<TwoSides>['fixture'],
    }),
  );
  const results: ResultOf<TwoSides>[] = fixtures.flatMap((f) => {
    if (f.fixture.kind !== 'pairing') return [];
    const sides = f.fixture.sides;
    const won = sides[winner(sides)];
    return [
      {
        id: `r-${f.id}`,
        fixture: f.id,
        kind: 'decided' as const,
        supersedes: null,
        certified: true,
        outcome: {
          kind: 'winner' as const,
          winner: won,
          ballots: [
            {
              judge: 'j',
              winner: won,
              points: sides.map((e) => ({
                entry: e,
                points: e === won ? 290 : 280,
              })),
            },
          ],
        },
      },
    ];
  });
  return {
    fixtures: [...history.fixtures, ...fixtures],
    results: [...history.results, ...results],
  };
};

export const withSettings = (
  changes: Partial<ResolvedSettings>,
): ResolvedSettings => ({ ...swissPower, ...changes });
