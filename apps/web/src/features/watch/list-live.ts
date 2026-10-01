import {
  debateSchedule,
  listDebates,
  spectatorDelaySeconds,
} from './debate-source';
import { liveCardOf, type LiveCard } from './live-card';
import { hubCounts, type HubCounts } from './hub-counts';
import { buildLiveListing } from './live-list';
import type { LiveQuery } from './live-query';

export type LiveHubListing = {
  readonly featured: LiveCard | null;
  readonly rows: readonly LiveCard[];
  /** Every listed live debate before filtering. */
  readonly total: number;
  readonly delaySeconds: number;
};

/**
 * The hub's live data seam: the public live debates for a query, with the
 * featured pick. The backend listing of public live debates replaces
 * `listDebates` and `debateSchedule`; the rules here stay.
 */
export function listLive(query: LiveQuery): LiveHubListing {
  const listing = buildLiveListing(listDebates(), query);
  const card = (debate: Parameters<typeof liveCardOf>[0]) => {
    const { phases, turns } = debateSchedule(debate);
    return liveCardOf(debate, phases, turns);
  };
  return {
    featured: listing.featured ? card(listing.featured) : null,
    rows: listing.rows.map(card),
    total: listing.total,
    delaySeconds: spectatorDelaySeconds,
  };
}

/** The tab counts for the hub header. */
export const countHub = (): HubCounts => hubCounts(listDebates());
