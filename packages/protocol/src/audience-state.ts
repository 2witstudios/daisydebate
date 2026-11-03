import { z } from 'zod';
import { audienceSnapshotSchema } from './audience';
import { spectatorTimelineSchema } from './spectator-timeline';

/** How often a tab says it is watching, before sampling. */
export const VIEWER_PULSE_MS = 25_000;
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

/** How many pulses a second the whole audience of one Round may send to web. */
export const VIEWER_PULSES_PER_SECOND = 20;

/**
 * A Round's released public state, as the player reads it from the public bucket
 * (DEC-350). Published by the worker, so no viewer's read reaches web.
 */
export const audienceStateSchema = z.strictObject({
  version: z.literal(1),
  publishedAtMs: z.int().nonnegative(),
  timeline: spectatorTimelineSchema,
  audience: audienceSnapshotSchema,
  /** The share of tabs that should pulse: each tab samples itself. */
  pulseRate: z.number().gt(0).max(1),
});
export type AudienceState = z.infer<typeof audienceStateSchema>;

/** Where a Round's state is published under the public bucket. */
export const audienceStatePath = (stateKey: string) => `state/${stateKey}.json`;

/** The sampling that keeps this audience's pulses near the limit. */
export const pulseRateFor = (viewers: number): number =>
  Math.min(
    1,
    (VIEWER_PULSES_PER_SECOND * VIEWER_PULSE_MS) / 1000 / Math.max(viewers, 1),
  );

/** Whether a tab that drew this, once, between 0 and 1, pulses at this rate. */
export const tabPulses = (draw: number, rate: number): boolean => draw < rate;

/** A sampled count scaled back up and rounded to what it can honestly say. */
export const viewersFromSample = (sampled: number, rate: number): number => {
  const viewers = sampled / rate;
  if (viewers < 100) return Math.round(viewers);
  const unit = 10 ** (Math.floor(Math.log10(viewers)) - 1);
  return Math.round(viewers / unit) * unit;
};
