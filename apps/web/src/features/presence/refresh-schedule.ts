/** The soonest a browser re-reads the list after a ring. */
export const ROSTER_FLOOR_MS = 2_000;
/** The latest: also the fallback when no ring arrives at all. */
export const ROSTER_CEILING_MS = 30_000;
/** Each browser reads at most this often per person online, in milliseconds. */
const MS_PER_MEMBER = 20;

/**
 * The gap between a browser's reads (ADR 0103). It grows with the list, so the
 * fleet's request rate stays near 50 reads a second up to about 1,500 online,
 * and a small room still feels instant.
 */
export const rosterFloorMs = (onlineCount: number): number =>
  Math.min(
    ROSTER_CEILING_MS,
    Math.max(ROSTER_FLOOR_MS, onlineCount * MS_PER_MEMBER),
  );

/**
 * How long to wait before re-reading after a ring: never inside the floor since
 * the last read, then jittered, so one ring never lands as one spike.
 */
export const nextReadDelayMs = (input: {
  readonly now: number;
  readonly lastReadAt: number;
  readonly onlineCount: number;
  /** A unit value that spreads the load. */
  readonly jitter: number;
}): number => {
  const floor = rosterFloorMs(input.onlineCount);
  const wait = Math.max(0, input.lastReadAt + floor - input.now);
  return wait + Math.round(input.jitter * Math.min(1_000, floor / 2));
};
