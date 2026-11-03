import { z } from 'zod';

/** Capture time in which the stage is known to have shown public speech. */
const publicIntervalSchema = z.strictObject({
  fromMs: z.int().nonnegative(),
  toMs: z.int().nonnegative(),
});
export const publicIntervalsSchema = z.array(publicIntervalSchema).max(10_000);
export type PublicInterval = z.infer<typeof publicIntervalSchema>;

/**
 * How far inside a committed boundary media must lie: Egress's capture stamps
 * against the web clock that wrote the boundary, plus pipeline latency. PLACEHOLDER
 * until staging measures that drift: every boundary loses this much public speech.
 */
const PUBLIC_EDGE_MARGIN_MS = 500;

/** Shorter than this holds no usable word, and players trip on it. */
const SHORTEST_CLIP_MS = 200;

type CommittedSegment = {
  readonly startedAtMs: number;
  readonly endedAtMs: number | null;
  readonly durationMs: number;
};

/**
 * What committed Round history proves public: each speech or cross-examination,
 * start to end, margin inside. Nothing else is, so anything with no row, prep and
 * every private phase included, is not. A segment still open is known only as far
 * as the control plane has been heard from, and never past its scheduled end. If
 * history later closes it, that proves the stretch (the point guard's rule): a late
 * commit is the only way anything unknown becomes public, and time alone never does.
 */
export const publicIntervals = (
  segments: readonly CommittedSegment[],
  knownThroughMs: number | null,
): readonly PublicInterval[] =>
  segments
    .map((segment) => ({
      fromMs: segment.startedAtMs + PUBLIC_EDGE_MARGIN_MS,
      toMs:
        (segment.endedAtMs ??
          Math.min(
            segment.startedAtMs + segment.durationMs,
            knownThroughMs ?? segment.startedAtMs,
          )) - PUBLIC_EDGE_MARGIN_MS,
    }))
    .filter(({ fromMs, toMs }) => toMs > fromMs)
    .sort((a, b) => a.fromMs - b.fromMs);

type Captured = {
  readonly capturedAtMs: number;
  readonly durationMs: number;
};

/**
 * Whether history is settled for all of this media. Until the control plane has
 * been heard from past it, a commit could still say anything about it, so it waits.
 * What is settled stays settled, so positions in the clips below never shift.
 */
export const settledByHeartbeat = (
  entry: Captured,
  knownThroughMs: number | null,
): boolean =>
  knownThroughMs !== null &&
  entry.capturedAtMs + entry.durationMs + PUBLIC_EDGE_MARGIN_MS <=
    knownThroughMs;

/** A part of one held segment to publish; `offsetMs` is where it starts inside it. */
export type PublicClip<T extends Captured> = {
  readonly source: T;
  readonly offsetMs: number;
  readonly capturedAtMs: number;
  readonly durationMs: number;
};

/**
 * Held media cut to the public intervals, to the millisecond: a segment straddling
 * a boundary keeps its public side, and one with two intervals gives two clips.
 * Whole segments go only where no interval touches them at all.
 */
export const publicClips = <T extends Captured>(
  entries: readonly T[],
  intervals: readonly PublicInterval[],
): readonly PublicClip<T>[] =>
  entries.flatMap((source) =>
    intervals.flatMap(({ fromMs, toMs }) => {
      const startMs = Math.max(fromMs, source.capturedAtMs);
      const endMs = Math.min(toMs, source.capturedAtMs + source.durationMs);
      return endMs - startMs < SHORTEST_CLIP_MS
        ? []
        : [
            {
              source,
              offsetMs: startMs - source.capturedAtMs,
              capturedAtMs: startMs,
              durationMs: endMs - startMs,
            },
          ];
    }),
  );
