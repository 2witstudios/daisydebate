/**
 * Where a Broadcast's public media lives in the public bucket. The worker writes
 * here and Stream this Round points here, so a streamer and a viewer read the
 * same released objects, under the same withdrawal.
 */
export const broadcastLivePrefix = (broadcastId: string) =>
  `live/${broadcastId}/`;

/** The official feed: the public master playlist. */
export const officialFeedPath = (broadcastId: string) =>
  `${broadcastLivePrefix(broadcastId)}master.m3u8`;
