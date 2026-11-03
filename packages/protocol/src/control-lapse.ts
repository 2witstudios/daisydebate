import { z } from 'zod';

/** A stretch of at least 10 s with no control plane, in the database's clock. */
const controlLapseSchema = z.strictObject({
  fromMs: z.int().nonnegative(),
  toMs: z.int().nonnegative(),
});
export const controlLapsesSchema = z.array(controlLapseSchema).max(10_000);
/** How a capture stores them. */
export const controlLapseRecordSchema = z.strictObject({
  lapses: controlLapsesSchema,
});
export type ControlLapse = z.infer<typeof controlLapseSchema>;

/**
 * Capture times come from Egress's clock and lapses from the database's, so the
 * boundary allows for them to disagree by this much, always toward leaving media out.
 */
const CLOCK_MARGIN_MS = 1000;

type Captured = {
  readonly capturedAtMs: number;
  readonly durationMs: number;
};

const endOf = (entry: Captured) =>
  entry.capturedAtMs + entry.durationMs + CLOCK_MARGIN_MS;

/**
 * Whether the last heartbeat has passed all of this media. Media it has not passed
 * waits, so a segment straddling the last heartbeat is never out before its fate is known.
 */
export const coveredByHeartbeat = (
  entry: Captured,
  heartbeatMs: number | null,
): boolean => heartbeatMs !== null && endOf(entry) <= heartbeatMs;

/**
 * Held media with anything touching a lapse removed, a straddling segment whole. A
 * segment released earlier ended before the heartbeat that a later lapse starts
 * from, so it is never removed, and positions in this list stay stable as lapses grow.
 */
export const outsideControlLapses = <T extends Captured>(
  entries: readonly T[],
  lapses: readonly ControlLapse[],
): readonly T[] =>
  entries.filter(
    (entry) =>
      !lapses.some(
        (lapse) =>
          endOf(entry) > lapse.fromMs &&
          entry.capturedAtMs - CLOCK_MARGIN_MS < lapse.toMs,
      ),
  );
