import type {
  Entry,
  Fixture,
  FormatDescriptor,
  HistoricFixture,
  Id,
  Result,
  StageHistory,
} from '../shapes/competition';
import type { Draw } from '../shapes/draw';
import type { Dice } from './scenario';

/** One event as the simulator holds it between tab rounds. */
export type EventState = {
  readonly id: Id;
  readonly format: FormatDescriptor;
  entries: Entry[];
  history: StageHistory<FormatDescriptor>;
  /** Results held back to arrive after the next draw. */
  late: Result[];
  readonly strength: ReadonlyMap<Id, number>;
};

const entriesIn = (fixture: Fixture): readonly Id[] =>
  fixture.kind === 'pairing'
    ? fixture.sides
    : fixture.kind === 'section'
      ? fixture.speakers
      : [fixture.entry];

/** The fixtures of a draw as history, with ids the caller would have minted. */
export const asHistory = (
  draw: Draw,
  prefix: string,
): HistoricFixture<FormatDescriptor>[] => [
  ...draw.keep.map((k) => ({
    id: k.id,
    tabRound: draw.tabRound,
    fixture: k.fixture as never,
  })),
  ...draw.add.map((a) => ({
    id: `${prefix}-${a.ordinal}`,
    tabRound: draw.tabRound,
    fixture: a.fixture as never,
  })),
];

/** A result for each fixture played: the stronger entry tends to win. */
export const playFixtures = (
  state: EventState,
  fixtures: readonly HistoricFixture<FormatDescriptor>[],
  d: Dice,
): Result[] =>
  fixtures.flatMap((f): Result[] => {
    const fixture = f.fixture as Fixture;
    if (fixture.kind === 'bye') return [];
    const seated = entriesIn(fixture);
    const panel = fixture.panel.length === 0 ? ['panel-auto'] : fixture.panel;
    const score = new Map(
      seated.map((e) => [e, (state.strength.get(e) ?? 0) + d.below(40)]),
    );
    const ranked = [...seated].sort((a, b) => score.get(b)! - score.get(a)!);
    const base = {
      id: `res-${f.id}`,
      fixture: f.id,
      kind: 'decided',
      supersedes: null,
      certified: true,
    } as const;
    if (state.format.outcome === 'winner') {
      const winner = ranked[0]!;
      return [
        {
          ...base,
          outcome: {
            kind: 'winner',
            winner,
            ballots: panel.map((judge) => ({
              judge,
              winner,
              points: seated.map((e) => ({
                entry: e,
                points: 270 + d.below(25) + (e === winner ? 5 : 0),
              })),
            })),
          },
        } as Result,
      ];
    }
    return [
      {
        ...base,
        outcome: {
          kind: 'ranking',
          places: ranked.map((entry, i) => ({ entry, place: i + 1 })),
          ballots: panel.map((judge) => ({
            judge,
            ranks: ranked.map((entry, i) => ({
              entry,
              rank: i + 1,
              points: 90 - i * 2 - d.below(2),
            })),
          })),
        },
      } as Result,
    ];
  });

/** A correction: a new result that supersedes an earlier one with another winner. */
export const correctionOf = (result: Result): Result => {
  const outcome = result.outcome;
  const corrected =
    outcome.kind === 'winner'
      ? {
          ...outcome,
          winner:
            outcome.ballots[0]?.points.find((p) => p.entry !== outcome.winner)
              ?.entry ?? outcome.winner,
        }
      : {
          ...outcome,
          places: [...outcome.places]
            .reverse()
            .map((p, i) => ({ entry: p.entry, place: i + 1 })),
        };
  return {
    ...result,
    id: `${result.id}-corrected`,
    supersedes: result.id,
    outcome: corrected,
  } as Result;
};
