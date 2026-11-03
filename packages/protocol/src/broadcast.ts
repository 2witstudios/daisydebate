import { z } from 'zod';

/** When a Broadcast may release: a delay, the Round's end, or a set time. */
export const broadcastReleasePolicySchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('delay'),
    seconds: z.int().nonnegative().max(86_400),
  }),
  z.strictObject({ kind: z.literal('round_end') }),
  z.strictObject({ kind: z.literal('at'), atMs: z.int().positive() }),
]);
export type BroadcastReleasePolicy = z.infer<
  typeof broadcastReleasePolicySchema
>;

/**
 * How far released media must have passed a fact before the fact leaves: three
 * 4 second segments, the live edge an HLS player sits behind.
 */
export const SPECTATOR_MARGIN_MS = 15_000;
