import { SPECTATOR_MARGIN_MS } from '@daisy/protocol';

/** How long one count gathers. A tab pulses at this rate, or a little faster. */
export const VIEWER_BUCKET_MS = 30_000;
/** Long enough to outlast the default delay; a longer hold simply shows no count. */
export const VIEWER_BUCKET_TTL_MS = 10 * 60_000;

export const viewerBucketOf = (atMs: number) =>
  Math.floor(atMs / VIEWER_BUCKET_MS);

/**
 * The newest bucket the timeline has wholly passed, or null when it has not
 * started. A count leaves as any other fact does, by the one horizon: a bucket's
 * end must be released, so nobody can read how many are watching ahead of the feed.
 */
export const releasedViewerBucket = (horizonMs: number | null) =>
  horizonMs === null
    ? null
    : viewerBucketOf(horizonMs - SPECTATOR_MARGIN_MS) - 1;
