import { officialFeedUrl } from '../broadcast/official-feed';

/** The address a Round's Broadcast is played from here; null when none is configured. */
export const broadcastFeedUrls =
  (origin: string | undefined) =>
  (broadcastId: string): string | null =>
    origin ? officialFeedUrl(origin, broadcastId) : null;
