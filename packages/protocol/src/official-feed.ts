/**
 * Where a Broadcast's public media lives in the public bucket, under the random
 * key set when it opened. The worker writes here, withdrawal deletes here and
 * every player and streamer reads here, so they all see the same released
 * objects, under the same withdrawal. The bucket is public: for an unlisted
 * Broadcast this unguessable name is what keeps the media from being found.
 */
export const broadcastLivePrefix = (feedKey: string) => `live/${feedKey}/`;

/** The official feed: the public master playlist. */
export const officialFeedPath = (feedKey: string) =>
  `${broadcastLivePrefix(feedKey)}master.m3u8`;
