import { canonicalOrder } from '@daisy/seeded-random';
import type {
  Fixture,
  FormatDescriptor,
  HistoricFixture,
  Id,
  Result,
  StageHistory,
} from '../shapes/competition';

/** One judge's verdict on one entry: a two-sided win is rank 1, a loss rank 2. */
type Ballot = {
  readonly won: boolean;
  readonly rank: number;
  readonly points: number;
};

/** One fixture an entry played, read from its effective result. */
export type Game = {
  readonly fixture: Id;
  readonly bye: boolean;
  readonly others: readonly Id[];
  /** The other entries of the fixture this entry finished above. */
  readonly beat: readonly Id[];
  /** The decided place, 1 the best; a two-sided win is 1 and a loss 2. */
  readonly place: number | null;
  readonly won: boolean;
  /** The largest rank `rank_truncation` keeps: the round's smallest section, or the side count. */
  readonly cap: number;
  readonly ballots: readonly Ballot[];
};

export type Played = {
  readonly games: ReadonlyMap<Id, readonly Game[]>;
  /** Byes at or before the cutoff, by entry. */
  readonly byes: ReadonlyMap<Id, number>;
};

export const entriesOf = (fixture: Fixture): readonly Id[] => {
  switch (fixture.kind) {
    case 'pairing':
      return fixture.sides;
    case 'section':
      return fixture.speakers;
    case 'bye':
      return [fixture.entry];
  }
};

const placesOf = (
  result: Result,
  entries: readonly Id[],
): ReadonlyMap<Id, number | null> => {
  const outcome = result.outcome;
  switch (outcome.kind) {
    case 'winner':
      return new Map(entries.map((e) => [e, outcome.winner === e ? 1 : 2]));
    case 'ranking':
      return new Map(
        entries.map((e) => [
          e,
          outcome.places.find((p) => p.entry === e)?.place ?? null,
        ]),
      );
  }
};

const ballotsOf = (result: Result, entry: Id): Ballot[] => {
  const outcome = result.outcome;
  switch (outcome.kind) {
    case 'winner':
      return outcome.ballots.map((b) => ({
        won: b.winner === entry,
        rank: b.winner === entry ? 1 : 2,
        points: b.points.find((p) => p.entry === entry)?.points ?? 0,
      }));
    case 'ranking':
      return outcome.ballots.flatMap((b) =>
        b.ranks
          .filter((r) => r.entry === entry)
          .map((r) => ({ won: r.rank === 1, rank: r.rank, points: r.points })),
      );
  }
};

const smallestSectionByRound = (
  fixtures: readonly HistoricFixture<FormatDescriptor>[],
) => {
  const smallest = new Map<number, number>();
  for (const { tabRound, fixture } of fixtures)
    if (fixture.kind === 'section')
      smallest.set(
        tabRound,
        Math.min(
          smallest.get(tabRound) ?? fixture.speakers.length,
          fixture.speakers.length,
        ),
      );
  return smallest;
};

const beaten = (entry: Id, places: ReadonlyMap<Id, number | null>) => {
  const own = places.get(entry) ?? null;
  return [...places].flatMap(([other, place]) =>
    other !== entry && own !== null && place !== null && own < place
      ? [other]
      : [],
  );
};

const byesThrough = (
  fixtures: readonly HistoricFixture<FormatDescriptor>[],
  cutoff: number,
) => {
  const byes = new Map<Id, number>();
  for (const { tabRound, fixture } of fixtures)
    if (fixture.kind === 'bye' && tabRound <= cutoff)
      byes.set(fixture.entry, (byes.get(fixture.entry) ?? 0) + 1);
  return byes;
};

const gamesOfResult = (
  held: HistoricFixture<FormatDescriptor>,
  result: Result,
  cap: number,
) => {
  const entries = entriesOf(held.fixture);
  const places = placesOf(result, entries);
  return entries.map((entry) => {
    const place = places.get(entry) ?? null;
    const game: Game = {
      fixture: held.id,
      bye: false,
      others: entries.filter((e) => e !== entry),
      beat: beaten(entry, places),
      place,
      won: place === 1,
      cap,
      ballots: ballotsOf(result, entry),
    };
    return { entry, game };
  });
};

/** Every entry's games and byes from the effective results, through the cutoff. */
export const playedGames = (
  history: StageHistory<FormatDescriptor>,
  results: readonly Result[],
  cutoff: number,
): Played => {
  const fixtures = canonicalOrder(history.fixtures);
  const byId = new Map(fixtures.map((f) => [f.id, f]));
  const smallest = smallestSectionByRound(fixtures);
  const games = new Map<Id, Game[]>();
  for (const result of results) {
    const held = byId.get(result.fixture);
    if (held === undefined || held.fixture.kind === 'bye') continue;
    const cap =
      held.fixture.kind === 'section'
        ? (smallest.get(held.tabRound) ?? held.fixture.speakers.length)
        : held.fixture.sides.length;
    for (const game of gamesOfResult(held, result, cap))
      games.set(game.entry, [...(games.get(game.entry) ?? []), game.game]);
  }
  return { games, byes: byesThrough(fixtures, cutoff) };
};
