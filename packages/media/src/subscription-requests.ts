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

/** An ask neither answered nor refused within this counts as refused. */
const ASK_TIMEOUT_MS = 10000;
/** A refused ask is made again after this, doubling to the ceiling. */
const RETRY_FIRST_MS = 1000;
const RETRY_MAX_MS = 30000;

/**
 * Which publications a subscriber has asked for. Every ask is answered (the
 * track arrives), refused, or times out; a refused or timed-out ask is made
 * again after a pause that doubles to a ceiling. A pending ask is never
 * repeated, and withdrawing, ending or closing forgets it entirely.
 */
export function createSubscriptionRequests(timers: Timers) {
  /** Each outstanding ask or retry, by publication sid, with its timer. */
  const pending = new Map<string, unknown>();
  /** The next retry pause per sid, kept until the track arrives or ends. */
  const pauses = new Map<string, number>();
  let closed = false;
  const cancel = (sid: string) => {
    if (pending.has(sid)) timers.clear(pending.get(sid));
    pending.delete(sid);
  };
  const forget = (sid: string) => {
    cancel(sid);
    pauses.delete(sid);
  };
  const refused = (sid: string, again: () => void) => {
    // Only an outstanding ask can be refused: a late or stray refusal for a
    // withdrawn or never-asked publication arms nothing.
    if (closed || !pending.has(sid)) return;
    const pauseMs = pauses.get(sid) ?? RETRY_FIRST_MS;
    pauses.set(sid, Math.min(pauseMs * 2, RETRY_MAX_MS));
    cancel(sid);
    pending.set(
      sid,
      timers.set(() => {
        pending.delete(sid);
        again();
      }, pauseMs),
    );
  };
  return {
    /**
     * Asks for or withdraws `publication` so it matches `want`. `again`
     * re-evaluates the publication when a refused ask is retried.
     */
    reconcile(publication: Publication, want: boolean, again: () => void) {
      const sid = publication.sid;
      if (closed || !sid) return;
      if (!want) {
        const asked = publication.subscribed || pending.has(sid);
        forget(sid);
        if (asked) publication.setSubscribed(false);
        return;
      }
      if (publication.subscribed || pending.has(sid)) return;
      publication.setSubscribed(true);
      pending.set(
        sid,
        timers.set(() => refused(sid, again), ASK_TIMEOUT_MS),
      );
    },
    /** The SFU refused the ask. */
    refused,
    /** The track arrived. */
    subscribed: forget,
    /** The publication went away. */
    ended: forget,
    close() {
      closed = true;
      for (const sid of [...pending.keys()]) forget(sid);
      pauses.clear();
    },
  };
}
