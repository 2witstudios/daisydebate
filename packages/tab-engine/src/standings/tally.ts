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
  readonly byeResult: 'win' | 'own_average';
  readonly panelSize: number;
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
    byeResult: input.settings['bye.result'].value,
    panelSize: input.settings['judging.panel'].preliminary.size,
    ratings: ratingsOf(input.ratings),
    results: results.map((r) => r.id),
  };
};

export const playedOf = (tally: Tally, entry: Id): readonly Game[] =>
  tally.games.get(entry) ?? [];

export const byesOf = (tally: Tally, entry: Id) => tally.byes.get(entry) ?? 0;

export const gamesCount = (tally: Tally, entry: Id) =>
  playedOf(tally, entry).length + byesOf(tally, entry);

const bestPlace = 1;

/** A bye under `win`: the format's best place, a winning ballot from every panel seat, no points. */
const byeGame = (tally: Tally): Game => ({
  fixture: '',
  bye: true,
  others: [],
  beat: [],
  place: bestPlace,
  won: true,
  cap: bestPlace,
  ballots: Array.from({ length: tally.panelSize }, () => ({
    won: true,
    rank: 1,
    points: 0,
  })),
});

/** The games a total counts: played ones, and each bye when a bye is a win. */
export const countedGames = (tally: Tally, entry: Id): readonly Game[] =>
  tally.byeResult === 'win'
    ? [
        ...playedOf(tally, entry),
        ...Array.from({ length: byesOf(tally, entry) }, () => byeGame(tally)),
      ]
    : playedOf(tally, entry);
