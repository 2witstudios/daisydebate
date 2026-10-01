import { debateRating, type WatchDebate } from './debate';
import type { LiveQuery } from './live-query';

/** A debate in progress that the hub may list: public and live. */
export type LiveDebate = WatchDebate & {
  readonly state: Extract<WatchDebate['state'], { status: 'live' }>;
};

/** The hub lists public live debates only; unlisted and private never show. */
export const isListedLive = (debate: WatchDebate): debate is LiveDebate =>
  debate.visibility === 'public' && debate.state.status === 'live';

/**
 * The featured debate: the highest-rated ranked debate live now, picked by
 * rating alone (ties break by the id so the pick is stable).
 */
export function featuredDebate(
  debates: readonly WatchDebate[],
): LiveDebate | null {
  const ranked = debates
    .filter(isListedLive)
    .filter((debate) => debate.mode === 'ranked');
  const [best] = [...ranked].sort(
    (x, y) => debateRating(y) - debateRating(x) || x.id.localeCompare(y.id),
  );
  return best ?? null;
}

/** Whether a debate passes the mode and search filters. */
function matchesFilters(debate: WatchDebate, query: LiveQuery): boolean {
  if (query.mode !== 'any' && query.mode !== debate.mode) return false;
  if (query.q === '') return true;
  const haystack = [debate.title, debate.aff.handle, debate.neg.handle]
    .join(' ')
    .toLowerCase();
  return haystack.includes(query.q.toLowerCase());
}

const comparators = {
  watched: (x: LiveDebate, y: LiveDebate) =>
    y.state.watching - x.state.watching || x.id.localeCompare(y.id),
  rated: (x: LiveDebate, y: LiveDebate) =>
    debateRating(y) - debateRating(x) || x.id.localeCompare(y.id),
} as const;

export type LiveListing = {
  /** The featured debate when it passes the filters. */
  readonly featured: LiveDebate | null;
  /** The remaining matches, in the query's order. */
  readonly rows: readonly LiveDebate[];
  /** Every listed live debate before filtering. */
  readonly total: number;
};

/** Filters and sorts the listed live debates for one hub query. */
export function buildLiveListing(
  debates: readonly WatchDebate[],
  query: LiveQuery,
): LiveListing {
  const listed = debates.filter(isListedLive);
  const top = featuredDebate(debates);
  const featured = top !== null && matchesFilters(top, query) ? top : null;
  const rows = listed
    .filter((debate) => debate.id !== top?.id)
    .filter((debate) => matchesFilters(debate, query))
    .sort(comparators[query.sort]);
  return { featured, rows, total: listed.length };
}
