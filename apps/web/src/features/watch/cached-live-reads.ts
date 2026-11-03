import type { Clock } from '@daisy/clock';
import { isTemporaryRefusal } from '@daisy/db/capacity';
import { createSnapshotMemo } from '../spectating/snapshot-memo';
import { spectatorClockAt } from '../spectating/spectator-clock';
import {
  leadingLive,
  listLive,
  type LiveHubListing,
  type LiveStore,
} from './list-live';
import type { LiveCard } from './live-card';
import type { LiveQuery } from './live-query';

const LIVE_TTL_MS = 5000;
const LIVE_PAGES = 500;

/**
 * The Live listing and what leads to it, the same for everyone who asks the same
 * thing, so an audience costs one read per page per interval. Nothing here is per
 * viewer, and a held page is only older than the release rule it applied.
 */
export const createCachedLiveReads = (deps: {
  readonly store: LiveStore;
  readonly clock: Pick<Clock, 'now'>;
}) => {
  const options = {
    nowMs: () => Date.parse(deps.clock.now()),
    ttlMs: LIVE_TTL_MS,
    maxEntries: LIVE_PAGES,
    keepsFailure: isTemporaryRefusal,
  };
  const pages = createSnapshotMemo<LiveHubListing>(options);
  const lead = createSnapshotMemo<readonly LiveCard[]>(options);
  const total = createSnapshotMemo<number>(options);
  return {
    listing: (query: LiveQuery) =>
      pages(JSON.stringify([query.mode, query.q, query.before]), () =>
        listLive(deps.store, { query, now: deps.clock.now() }),
      ),
    leading: () =>
      lead('lead', () => leadingLive(deps.store, deps.clock.now())),
    count: () =>
      total('total', () =>
        deps.store.countLiveBroadcasts({
          clock: spectatorClockAt(deps.clock.now()),
        }),
      ),
  };
};
