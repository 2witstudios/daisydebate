/**
 * The one rule for when a segment is due to end. A row keeps the duration its
 * rules froze; time a platform incident took is returned beside it, never
 * written over it. Every reader in TypeScript goes through here, and SQL reads
 * the generated column `round_segments.due_at`.
 */
export type SegmentTiming = {
  readonly startedAtMs: number;
  readonly durationMs: number;
  readonly returnedMs: number;
};

/** The instant a segment is due to end if nothing closes it first. */
export const segmentDueAtMs = (segment: SegmentTiming): number =>
  segment.startedAtMs + segment.durationMs + segment.returnedMs;

/** Speaking stops at the close or the due instant, whichever comes first. */
export const speakingEndMs = (
  segment: SegmentTiming & { readonly endedAtMs: number | null },
): number => Math.min(segment.endedAtMs ?? Infinity, segmentDueAtMs(segment));
