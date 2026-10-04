import {
  EARLY_SEASON_ESTABLISHED,
  PAGE_SIZE,
  type LadderData,
  type LadderView,
  type LadderViewer,
} from './ladder-view';
import {
  aroundWindow,
  applyFilters,
  hasFilters,
  matchesSearch,
  pinnedFor,
  toRow,
  type RowContext,
} from './ladder-rows';
import type { LadderQuery } from './query';
import type { LadderStatus } from './query';
import { isClosed, type Season } from './season';
import { rankEntries, type RankedEntry } from './standing';

type Empty = LadderView['empty'];

const emptyKind = (
  shown: number,
  newSeason: boolean,
  provisionalHits: number,
): Empty => {
  if (shown > 0) return 'no';
  if (newSeason) return 'new-season';
  return provisionalHits > 0 ? 'provisional-hits' : 'filtered';
};

type Paging = {
  readonly page: number;
  readonly pageCount: number;
  readonly slice: readonly RankedEntry[];
};

/** One page of the table; the around-me window is a single fixed page. */
function paginate(
  shown: readonly RankedEntry[],
  fixed: boolean,
  requested: number,
): Paging {
  if (fixed) return { page: 1, pageCount: 1, slice: shown };
  const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
  const page = Math.min(requested, pageCount);
  return {
    page,
    pageCount,
    slice: shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
  };
}

const provisionalHitsFor = (
  ranked: readonly RankedEntry[],
  query: LadderQuery,
  status: string,
): number =>
  query.q !== '' && status === 'established'
    ? ranked.filter(
        (entry) => entry.provisional && matchesSearch(entry, query.q),
      ).length
    : 0;

type Visible = Paging & {
  readonly window: ReturnType<typeof aroundWindow> | null;
  readonly total: number;
  readonly podium: boolean;
};

/** Which entries show, on which page, and whether the podium leads. */
function visibleRows(
  ranked: readonly RankedEntry[],
  query: LadderQuery,
  status: LadderStatus,
  mine: RankedEntry | undefined,
  quiet: boolean,
): Visible {
  const window =
    query.scope === 'around' && mine ? aroundWindow(ranked, mine) : null;
  const shown = window?.shown ?? applyFilters(ranked, query, status);
  const paging = paginate(shown, window !== null, query.page);
  return {
    ...paging,
    window,
    total: shown.length,
    podium: window === null && paging.page === 1 && quiet && shown.length >= 3,
  };
}

/** A live season with few established debaters shows Everyone. */
const isEarly = (season: Season, established: number): boolean =>
  !isClosed(season) &&
  established > 0 &&
  established < EARLY_SEASON_ESTABLISHED;

/** Everything the ladder screen shows, from one season's entries. */
export function buildLadder(
  data: LadderData,
  query: LadderQuery,
  viewer: LadderViewer | null,
): LadderView {
  const { season } = data;
  const ranked = rankEntries(data.entries);
  const established = ranked.filter((entry) => !entry.provisional).length;
  const early = isEarly(season, established);
  const status =
    early && query.status === 'established' ? 'everyone' : query.status;
  const mine = ranked.find((entry) => entry.username === viewer?.username);
  const context: RowContext = { season, query, viewer, mine };
  const filtered = hasFilters(query);
  const visible = visibleRows(ranked, query, status, mine, !filtered && !early);
  const provisionalHits = provisionalHitsFor(ranked, query, status);
  const row = (entry: RankedEntry) => toRow(entry, context);
  const lead = visible.podium ? 3 : 0;

  return {
    season,
    seasons: data.seasons,
    rows: visible.slice.slice(lead).map(row),
    podium: visible.slice.slice(0, lead).map(row),
    page: visible.page,
    pageCount: visible.pageCount,
    total: visible.total,
    established,
    provisional: ranked.length - established,
    around: visible.window !== null,
    gapNote: visible.window?.note ?? '',
    empty: emptyKind(
      visible.total,
      !isClosed(season) && established === 0 && !filtered,
      provisionalHits,
    ),
    provisionalHits,
    early,
    status,
    pinned: pinnedFor(ranked, context),
    hasStanding: mine !== undefined,
    previousChampion: data.previousChampion,
    pendingChanges: data.pendingChanges,
    filtered,
  };
}
