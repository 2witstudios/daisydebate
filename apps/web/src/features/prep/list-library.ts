import {
  sampleLibrary,
  sampleSavedSearches,
  sampleTeamSummaries,
} from '../../ui/mock/prep';
import {
  filterOptions,
  inView,
  matching,
  matchingSearch,
  recentlyOpened,
  sortItems,
  viewCounts,
  type ViewCounts,
} from './library-filter';
import {
  defaultLibraryQuery,
  hasFilters,
  libraryHref,
  type LibraryQuery,
} from './library-query';
import { toRow, type LibraryRow } from './library-row';

export type SavedSearch = {
  readonly id: string;
  readonly name: string;
  readonly href: string;
  readonly count: number;
};

export type TeamSummary = {
  readonly id: string;
  readonly name: string;
  readonly memberHandles: readonly string[];
  readonly sharedCount: number;
};

export type LibraryListing = {
  /** Every item the owner has, before any search or filter. */
  readonly total: number;
  /** Counts under the current search and filters, one per tab. */
  readonly counts: ViewCounts;
  readonly rows: readonly LibraryRow[];
  /** Items the search finds before the filters narrow it. */
  readonly searchMatches: number;
  /** The last items opened: shown on the unfiltered All tab only. */
  readonly jumpBackIn: readonly LibraryRow[];
  readonly options: ReturnType<typeof filterOptions>;
  readonly savedSearches: readonly SavedSearch[];
  readonly teams: readonly TeamSummary[];
};

const JUMP_BACK_COUNT = 3;

/**
 * The library's one data seam. It returns the owner's items for a query at
 * `now` (an ISO timestamp the caller injects). Today it reads the sample
 * library; the backend read replaces this function and nothing else.
 */
export function listLibrary(query: LibraryQuery, now: string): LibraryListing {
  const all = sampleLibrary(now);
  const found = matching(all, query);
  const isPlainAll =
    query.view === 'all' && query.q === '' && !hasFilters(query);
  return {
    total: all.length,
    counts: viewCounts(found),
    rows: sortItems(inView(found, query.view), query.sort).map((item) =>
      toRow(item, now),
    ),
    searchMatches: matchingSearch(all, query).length,
    jumpBackIn: isPlainAll
      ? recentlyOpened(all, JUMP_BACK_COUNT).map((item) => toRow(item, now))
      : [],
    options: filterOptions(all),
    savedSearches: sampleSavedSearches.map((saved) => {
      const savedQuery = { ...defaultLibraryQuery, ...saved.query };
      return {
        id: saved.id,
        name: saved.name,
        href: libraryHref(savedQuery),
        count: matching(all, savedQuery).length,
      };
    }),
    teams: sampleTeamSummaries,
  };
}
