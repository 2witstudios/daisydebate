import { officialFeedPath } from '@daisy/protocol';

/** The one address of a Broadcast's released media, for a player or a streamer. */
export const officialFeedUrl = (origin: string, broadcastId: string): string =>
  new URL(officialFeedPath(broadcastId), origin).href;
