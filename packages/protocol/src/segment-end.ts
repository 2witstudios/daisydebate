/**
 * The one rule for when a segment is due to end. Every reader in TypeScript
 * goes through it, so what a speech is owed changes in one place.
 */
export type SegmentTiming = {
  readonly startedAtMs: number;
  readonly durationMs: number;
};

/** The instant a segment is due to end if nothing closes it first. */
export const segmentDueAtMs = (segment: SegmentTiming): number =>
  segment.startedAtMs + segment.durationMs;

/** Speaking stops at the close or the due instant, whichever comes first. */
export const speakingEndMs = (
  segment: SegmentTiming & { readonly endedAtMs: number | null },
): number => Math.min(segment.endedAtMs ?? Infinity, segmentDueAtMs(segment));
