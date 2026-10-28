/** A remote publication as far as subscribing goes. */
type Publication = {
  readonly sid?: string | undefined;
  /** True only once the track has arrived, not when it is asked for. */
  readonly subscribed: boolean;
  setSubscribed(subscribed: boolean): void;
};
type Timers = {
  readonly set: (run: () => void, ms: number) => unknown;
  readonly clear: (handle: unknown) => void;
};

/** A failed subscription is asked again after this, doubling to the ceiling. */
const RETRY_FIRST_MS = 1000;
const RETRY_MAX_MS = 30000;

/**
 * Which publications a subscriber has asked for. A pending ask is never
 * repeated, a withdrawn one is withdrawn once, and one the SFU refuses is
 * asked again after a pause that doubles to a ceiling.
 */
export function createSubscriptionRequests(timers: Timers) {
  const requested = new Set<string>();
  const retries = new Map<string, { pauseMs: number; handle?: unknown }>();
  const cancelRetry = (sid: string) => {
    const retry = retries.get(sid);
    if (retry?.handle !== undefined) timers.clear(retry.handle);
    retries.delete(sid);
  };
  return {
    /** Asks for or withdraws `publication` so it matches `want`. */
    reconcile(publication: Publication, want: boolean) {
      const sid = publication.sid;
      if (!sid) return;
      const asked = publication.subscribed || requested.has(sid);
      if (want === asked) return;
      if (asked) {
        requested.delete(sid);
        cancelRetry(sid);
      } else requested.add(sid);
      publication.setSubscribed(want);
    },
    /** The track arrived: a pending retry is moot. */
    subscribed: cancelRetry,
    /** The track went away: a later want asks again. */
    ended(sid: string) {
      requested.delete(sid);
    },
    /** The SFU refused the ask: `retry` runs after the pause. */
    failed(sid: string, retry: () => void) {
      requested.delete(sid);
      const pauseMs = retries.get(sid)?.pauseMs ?? RETRY_FIRST_MS;
      cancelRetry(sid);
      retries.set(sid, {
        pauseMs: Math.min(pauseMs * 2, RETRY_MAX_MS),
        handle: timers.set(retry, pauseMs),
      });
    },
    close() {
      for (const sid of [...retries.keys()]) cancelRetry(sid);
    },
  };
}
