/** How long one count gathers. A tab pulses at this rate, or a little faster. */
export const VIEWER_BUCKET_MS = 30_000;
/** Outlasts the newest whole bucket a read asks for, and nothing more. */
export const VIEWER_BUCKET_TTL_MS = 2 * 60_000;

export const viewerBucketOf = (atMs: number) =>
  Math.floor(atMs / VIEWER_BUCKET_MS);

/**
 * The newest bucket that has finished gathering: how many are watching now, near
 * enough. A count is the audience's own, so it is not held to the timeline.
 */
export const latestViewerBucket = (nowMs: number) => viewerBucketOf(nowMs) - 1;
