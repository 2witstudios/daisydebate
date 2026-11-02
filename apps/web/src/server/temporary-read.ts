/** A read that did not answer; `temporary` when asking again can help. */
export type UnavailableRead = {
  readonly kind: 'unavailable';
  readonly temporary?: true;
};

/**
 * Asking again helps only when the route says so: a capacity refusal's 503
 * carries `Retry-After` (work that never ran, ADR 0088 §4) and a rate limit's
 * window passes. A 503 without it may never pass, so it stays a plain failure.
 */
export const unavailableRead = (response: Response): UnavailableRead =>
  response.status === 429 || response.headers.has('retry-after')
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
