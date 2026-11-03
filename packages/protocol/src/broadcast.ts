import { z } from 'zod';

/** The latest instant a Date can hold: a set time past it is no time at all. */
const MAX_DATE_MS = 8_640_000_000_000_000;

/** When a Broadcast may release: a delay, the Round's end, or a set time. */
export const broadcastReleasePolicySchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('delay'),
    seconds: z.int().min(10).max(86_400),
  }),
  z.strictObject({ kind: z.literal('round_end') }),
  z.strictObject({
    kind: z.literal('at'),
    atMs: z.int().positive().max(MAX_DATE_MS),
  }),
]);

/** What the worker gave up on, by the clip's capture time. */
export const releaseSkipsSchema = z.strictObject({
  clips: z.array(z.int().nonnegative()).max(100_000),
});
export type BroadcastReleasePolicy = z.infer<
  typeof broadcastReleasePolicySchema
>;

/**
 * How far released media must have passed a fact before the fact leaves: three
 * 4 second segments, the live edge an HLS player sits behind.
 */
export const SPECTATOR_MARGIN_MS = 15_000;
