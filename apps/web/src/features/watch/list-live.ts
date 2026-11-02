import type { WatchSource } from './round-source';
import { liveCardOf, type LiveCard } from './live-card';
import { hubCounts, type HubCounts } from './hub-counts';
import { buildLiveListing } from './live-list';
import type { LiveQuery } from './live-query';

export type LiveHubListing = {
  readonly featured: LiveCard | null;
  readonly rows: readonly LiveCard[];
  /** Every listed live Round before filtering. */
  readonly total: number;
  readonly delaySeconds: number;
};

/**
 * The hub's live data seam: the public live Rounds for a query, with the
 * featured pick.
 */
export function listLive(
  query: LiveQuery,
  source: WatchSource,
): LiveHubListing {
  const listing = buildLiveListing(source.rounds, query);
  const card = (round: Parameters<typeof liveCardOf>[0]) => {
    const { phases, turns } = source.schedule(round);
    return liveCardOf(round, phases, turns);
  };
  return {
    featured: listing.featured ? card(listing.featured) : null,
    rows: listing.rows.map(card),
    total: listing.total,
    delaySeconds: source.delaySeconds,
  };
}

/** The tab counts for the hub header. */
export const countHub = (source: WatchSource): HubCounts =>
  hubCounts(source.rounds);
