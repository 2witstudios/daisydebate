/** A read that did not answer; `temporary` when asking again can help. */
export type UnavailableRead = {
  readonly kind: 'unavailable';
  readonly temporary?: true;
};

/**
 * A 503 is the route's retryable INFRASTRUCTURE, which a capacity refusal
 * becomes (ADR 0088 §4), and the route has already logged and reported it. Any
 * other failure, or an answer this build cannot read, is not known to pass.
 */
export const unavailableRead = (response?: Response): UnavailableRead =>
  response?.status === 503
    ? { kind: 'unavailable', temporary: true }
    : { kind: 'unavailable' };

/** A fixed floor: long enough for a refused lane's one-second wait to pass. */
const RETRY_FLOOR_SECONDS = 2;
const RETRY_SPREAD_SECONDS = 3;
/**
 * When a page refused from a burst asks again: 2 to 4 s, so pages refused
 * together do not return together. Whole seconds, because the HTML refresh
 * algorithm discards a fraction. `entropy` is a random byte from the edge.
 */
export const retrySeconds = (entropy: number): number =>
  RETRY_FLOOR_SECONDS + (entropy % RETRY_SPREAD_SECONDS);
