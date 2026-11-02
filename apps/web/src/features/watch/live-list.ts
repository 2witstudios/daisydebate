import { roundRating, type WatchRound } from './round';
import type { LiveQuery } from './live-query';

/** A Round in progress that the hub may list: public and live. */
export type LiveRound = WatchRound & {
  readonly state: Extract<WatchRound['state'], { status: 'live' }>;
};

/** The hub lists public live Rounds only; unlisted and private never show. */
export const isListedLive = (round: WatchRound): round is LiveRound =>
  round.visibility === 'public' && round.state.status === 'live';

/**
 * The featured Round: the highest-rated ranked Round live now, picked by
 * rating alone (ties break by the id so the pick is stable).
 */
export function featuredRound(rounds: readonly WatchRound[]): LiveRound | null {
  const ranked = rounds
    .filter(isListedLive)
    .filter((round) => round.mode === 'ranked');
  const [best] = [...ranked].sort(
    (x, y) => roundRating(y) - roundRating(x) || x.id.localeCompare(y.id),
  );
  return best ?? null;
}

/** Whether a Round passes the mode and search filters. */
export function matchesFilters(
  round: WatchRound,
  query: Pick<LiveQuery, 'mode' | 'q'>,
): boolean {
  if (query.mode !== 'any' && query.mode !== round.mode) return false;
  if (query.q === '') return true;
  const haystack = [round.title, round.aff.handle, round.neg.handle]
    .join(' ')
    .toLowerCase();
  return haystack.includes(query.q.toLowerCase());
}

const comparators = {
  watched: (x: LiveRound, y: LiveRound) =>
    y.state.watching - x.state.watching || x.id.localeCompare(y.id),
  rated: (x: LiveRound, y: LiveRound) =>
    roundRating(y) - roundRating(x) || x.id.localeCompare(y.id),
} as const;

export type LiveListing = {
  /** The featured Round when it passes the filters. */
  readonly featured: LiveRound | null;
  /** The remaining matches, in the query's order. */
  readonly rows: readonly LiveRound[];
  /** Every listed live Round before filtering. */
  readonly total: number;
};

/** Filters and sorts the listed live Rounds for one hub query. */
export function buildLiveListing(
  rounds: readonly WatchRound[],
  query: LiveQuery,
): LiveListing {
  const listed = rounds.filter(isListedLive);
  const top = featuredRound(rounds);
  const featured = top !== null && matchesFilters(top, query) ? top : null;
  const rows = listed
    .filter((round) => round.id !== top?.id)
    .filter((round) => matchesFilters(round, query))
    .sort(comparators[query.sort]);
  return { featured, rows, total: listed.length };
}
