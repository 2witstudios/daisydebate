/** A read that did not answer; `temporary` when asking again can help. */
export type UnavailableRead = {
  readonly kind: 'unavailable';
  readonly temporary?: true;
};

/**
 * Asking again helps only when the route says so: a temporary refusal's 503
 * carries `Retry-After` (work that never ran, ADR 0088 §4) and a rate limit's
 * window passes. A 503 without it may never pass, so it stays a plain failure.
 */
export const unavailableRead = (response: Response): UnavailableRead =>
  response.status === 429 ||
  (response.status === 503 && response.headers.has('retry-after'))
    ? { kind: 'unavailable', temporary: true }
    : { kind: 'unavailable' };

/** Whether a read's answer was a refusal asking again can help. */
export const temporarilyRefused = <Read extends { readonly kind: string }>(
  read: Read,
): read is Read & UnavailableRead & { readonly temporary: true } =>
  read.kind === 'unavailable' && 'temporary' in read && read.temporary === true;
