import { sampleLibrary, sampleSavedSearches } from '../../../ui/mock/prep';
import {
  filterOptions,
  inView,
  matching,
  matchingSearch,
  sortItems,
  viewCounts,
  type ViewCounts,
} from './library-filter';
import {
  defaultLibraryQuery,
  libraryHref,
  type LibraryQuery,
} from './library-query';
import { listTeams } from '../teams/get-team';
import {
  toPreview,
  toRow,
  type LibraryPreview,
  type LibraryRow,
} from './library-row';

/** A row as the library lists it: it opens in the preview pane. */
export type ListedRow = LibraryRow & {
  readonly previewHref: string;
  readonly selected: boolean;
};

type SavedSearch = {
  readonly id: string;
  readonly name: string;
  readonly href: string;
  readonly count: number;
};

type TeamSummary = {
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
  readonly rows: readonly ListedRow[];
  /** The selected row, or the first; undefined when nothing is listed. */
  readonly preview: LibraryPreview | undefined;
  /** Items the search finds before the filters narrow it. */
  readonly searchMatches: number;
  readonly options: ReturnType<typeof filterOptions>;
  readonly savedSearches: readonly SavedSearch[];
  readonly teams: readonly TeamSummary[];
};

/**
 * The library's one data seam. It returns the owner's items for a query at
 * `now` (an ISO timestamp the caller injects). Today it reads the sample
 * library; the backend read replaces this function and nothing else.
 */
export function listLibrary(query: LibraryQuery, now: string): LibraryListing {
  const all = sampleLibrary(now);
  const found = matching(all, query);
  const shown = sortItems(inView(found, query.view), query.sort);
  const selected = shown.find((item) => item.id === query.item) ?? shown[0];
  return {
    total: all.length,
    counts: viewCounts(found),
    rows: shown.map((item) => ({
      ...toRow(item, now),
      previewHref: libraryHref({ ...query, item: item.id }),
      selected: item.id === selected?.id,
    })),
    preview: selected === undefined ? undefined : toPreview(selected, now),
    searchMatches: matchingSearch(all, query).length,
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
    teams: listTeams().map((team) => ({
      id: team.id,
      name: team.name,
      memberHandles: team.members.map((m) => m.handle),
      sharedCount: team.items.length,
    })),
  };
}
