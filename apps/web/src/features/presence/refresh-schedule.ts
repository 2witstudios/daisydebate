/** The soonest a browser re-reads the list after a ring. */
export const PEOPLE_READ_FLOOR_MS = 2_000;
/** The latest: also the fallback when no ring arrives at all. */
export const PEOPLE_READ_CEILING_MS = 30_000;
/** Each browser reads at most this often per person online, in milliseconds. */
const MS_PER_MEMBER = 20;

/**
 * What one browser's reads scale with (ADR 0105): who is online, for the fleet's
 * rate, or the rows it has loaded, because a re-read walks every loaded page.
 */
export const peopleReadCount = (list: {
  readonly counts: { readonly online: number };
  readonly people: readonly unknown[];
}): number => Math.max(list.counts.online, list.people.length);

/**
 * The gap between a browser's reads (ADR 0103). It grows with that count, so the
 * fleet's request rate stays near 50 reads a second up to about 1,500 online,
 * a long list stays inside the read budget, and a small room still feels instant.
 */
export const peopleReadFloorMs = (peopleCount: number): number =>
  Math.min(
    PEOPLE_READ_CEILING_MS,
    Math.max(PEOPLE_READ_FLOOR_MS, peopleCount * MS_PER_MEMBER),
  );

/**
 * How long to wait before re-reading after a ring: never inside the floor since
 * the last read, then jittered, so one ring never lands as one spike.
 */
export const nextReadDelayMs = (input: {
  readonly now: number;
  readonly lastReadAt: number;
  readonly peopleCount: number;
  /** A unit value that spreads the load. */
  readonly jitter: number;
}): number => {
  const floor = peopleReadFloorMs(input.peopleCount);
  const wait = Math.max(0, input.lastReadAt + floor - input.now);
  return wait + Math.round(input.jitter * Math.min(1_000, floor / 2));
};
