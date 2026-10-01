import {
  sampleEntries,
  sampleTournaments,
  sampleViewer,
} from '../../ui/mock/tournaments';
import type { Entry, Viewer } from './entry';
import { filterTournaments, tabCounts, type TabCounts } from './filter';
import type { TournamentsQuery } from './query';
import { statusOf, type Tournament } from './tournament';

export type TournamentRow = {
  readonly tournament: Tournament;
  /** The viewer's own standing, or null (always null when signed out). */
  readonly entry: Entry | null;
};

export type YourTournament = {
  readonly tournament: Tournament;
  readonly entry: Entry;
};

export type TournamentsListing = {
  /** Null when signed out: anyone can browse. */
  readonly viewer: Viewer | null;
  readonly rows: readonly TournamentRow[];
  readonly counts: TabCounts;
  readonly featured: TournamentRow | null;
  /** The viewer's live and upcoming tournaments, in progress first. */
  readonly yours: readonly YourTournament[];
};

/**
 * The index's one data seam. It returns the tournaments for a query as seen
 * by the viewer (`signedIn` comes from the request's identity). Today it
 * reads sample data; the backend read that lists published tournaments and
 * the viewer's entries replaces this function and nothing else.
 */
export function listTournaments(
  query: TournamentsQuery,
  signedIn: boolean,
): TournamentsListing {
  const viewer = signedIn ? sampleViewer : null;
  const entryOf = (tournament: Tournament): Entry | null =>
    viewer ? (sampleEntries[tournament.id] ?? null) : null;
  const all = sampleTournaments.map((tournament) => ({
    tournament,
    entry: entryOf(tournament),
  }));
  const yours = all.flatMap(({ tournament, entry }) =>
    entry ? [{ tournament, entry }] : [],
  );
  const rank = (item: YourTournament) =>
    statusOf(item.tournament) === 'live' ? 0 : 1;
  const tournaments = sampleTournaments;
  return {
    viewer,
    rows: filterTournaments(tournaments, query).map((tournament) => ({
      tournament,
      entry: entryOf(tournament),
    })),
    counts: tabCounts(tournaments),
    featured: all.find(({ tournament }) => tournament.featured) ?? null,
    yours: [...yours].sort((a, b) => rank(a) - rank(b)),
  };
}
