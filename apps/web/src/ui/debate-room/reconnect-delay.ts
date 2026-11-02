/** A fixed floor: long enough for a refused lane's one-second wait to pass. */
const FLOOR_SECONDS = 2;
const SPREAD_SECONDS = 3;
/**
 * When a page refused from a burst asks again: 2 to 4 s, so pages refused
 * together do not return together. Whole seconds, because the HTML refresh
 * algorithm discards a fraction. `entropy` is a random byte from the edge.
 */
export const reconnectDelaySeconds = (entropy: number): number =>
  FLOOR_SECONDS + (entropy % SPREAD_SECONDS);
