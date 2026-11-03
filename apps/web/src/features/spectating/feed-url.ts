import { officialFeedUrl } from '../broadcast/official-feed';

/** The address a Broadcast is played from here; null when none is configured. */
export const broadcastFeedUrls =
  (origin: string | undefined) =>
  (feedKey: string): string | null =>
    origin ? officialFeedUrl(origin, feedKey) : null;
