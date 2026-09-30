import type { TournamentsQuery } from './query';
import { rulesLabel, structureLabel } from './labels';
import {
  tabOf,
  tournamentTabs,
  type Tournament,
  type TournamentTab,
} from './tournament';

/** Search ignores case; it reads the name, structure and rules. */
const matchesSearch = (tournament: Tournament, q: string): boolean => {
  if (q === '') return true;
  const text = q.toLowerCase();
  return [
    tournament.name,
    structureLabel(tournament.structure),
    rulesLabel(tournament.rules),
  ].some((field) => field.toLowerCase().includes(text));
};

/** The tournaments on the query's tab that satisfy every filter, in order. */
export const filterTournaments = (
  items: readonly Tournament[],
  query: TournamentsQuery,
): readonly Tournament[] =>
  items.filter(
    (item) =>
      tabOf(item) === query.tab &&
      (query.structure === 'all' || item.structure === query.structure) &&
      (query.rules === 'all' || item.rules === query.rules) &&
      matchesSearch(item, query.q),
  );

export type TabCounts = Readonly<Record<TournamentTab, number>>;

/** Tab totals over the whole listing, so they do not move with filters. */
export const tabCounts = (items: readonly Tournament[]): TabCounts =>
  Object.fromEntries(
    tournamentTabs.map((tab) => [
      tab,
      items.filter((item) => tabOf(item) === tab).length,
    ]),
  ) as TabCounts;
