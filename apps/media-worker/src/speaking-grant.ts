/** A server-time bracket of one 10 ms frame. */
type Window = { readonly beforeMs: number; readonly afterMs: number };
/** The open segment and its speaking grants, as any media worker role reads them. */
export type SpeakingGrants = {
  readonly segment: {
    readonly startedAt: string;
    /** Absent when the read only ever returns an open segment. */
    readonly endedAt?: string | null;
    readonly durationMs: number;
  } | null;
  readonly intervals: readonly {
    readonly roundParticipantId: string;
    readonly startedAt: string;
    readonly endedAt: string | null;
  }[];
};

/**
 * Whether a frame sits inside the segment's window and inside exactly one of
 * the seat's speaking grants. Cached authority is only a staging filter;
 * fresh PG horizon is checked separately. Capture keeps only such frames,
 * and the bot listener relays only such frames, so a seat without the floor
 * never reaches either (ISSUE-764).
 */
export function contained(state: SpeakingGrants, seat: string, window: Window) {
  const segment = state.segment;
  if (
    !segment ||
    window.beforeMs < Date.parse(segment.startedAt) ||
    window.afterMs >=
      Math.min(
        segment.endedAt == null ? Infinity : Date.parse(segment.endedAt),
        Date.parse(segment.startedAt) + segment.durationMs,
      )
  )
    return false;
  return (
    state.intervals.filter(
      (i) =>
        i.roundParticipantId === seat &&
        Date.parse(i.startedAt) <= window.beforeMs &&
        (i.endedAt === null || window.afterMs < Date.parse(i.endedAt)),
    ).length === 1
  );
}
