import type {
  EntryRating,
  FormatDescriptor,
  Id,
  RatingSnapshot,
  StageHistory,
} from '../shapes/competition';
import type { StandingsInput } from '../shapes/folds';
import { effectiveResults } from './effective-results';
import { type Game, type Played, playedGames } from './games';

/** Everything a metric reads, built once per standings call. */
export type Tally = Played & {
  readonly format: FormatDescriptor;
  readonly ratings: ReadonlyMap<Id, EntryRating> | null;
  readonly results: readonly Id[];
};

const ratingsOf = (snapshot: RatingSnapshot | null) =>
  snapshot === null
    ? null
    : new Map<Id, EntryRating>(
        snapshot.entries.map((r) => [
          r.entry,
          r.status === 'rated'
            ? { status: 'rated', rating: r.rating, deviation: r.deviation }
            : { status: 'unrated' },
        ]),
      );

export const tallyOf = (input: StandingsInput): Tally => {
  const history: StageHistory<FormatDescriptor> = input.history;
  const results = effectiveResults(history, input.cutoff);
  return {
    ...playedGames(history, results, input.cutoff),
    format: input.format,
    ratings: ratingsOf(input.ratings),
    results: results.map((r) => r.id),
  };
};

export const playedOf = (tally: Tally, entry: Id): readonly Game[] =>
  tally.games.get(entry) ?? [];

export const byesOf = (tally: Tally, entry: Id) => tally.byes.get(entry) ?? [];

export const gamesCount = (tally: Tally, entry: Id) =>
  playedOf(tally, entry).length + byesOf(tally, entry).length;

/** Explicit win credits carry their original panel size without inventing ballots. */
export const countedGames = (tally: Tally, entry: Id): readonly Game[] => [
  ...playedOf(tally, entry),
  ...byesOf(tally, entry).flatMap((bye) =>
    bye.rule === 'win'
      ? [
          {
            fixture: bye.fixture,
            bye: true,
            others: [],
            beat: [],
            place: 1,
            won: true,
            cap: 1,
            ballots: [],
            credits: {
              ballotsWon: bye.panelSize,
              ranks: Array.from({ length: bye.panelSize }, () => 1),
              points: 0,
            },
          },
        ]
      : [],
  ),
];
