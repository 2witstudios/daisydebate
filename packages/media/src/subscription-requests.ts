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
 * track arrives), refused, or times out. A refused or timed-out ask, or a
 * held track the SFU drops, is asked again after a pause that doubles to a
 * ceiling; the pause survives an arrival until the track has held for
 * as long as that pause, so a flapping track backs off instead of looping while
 * a stable one recovers quickly. A pending ask is never repeated, and withdrawing,
 * ending or closing forgets it entirely.
 */
export function createSubscriptionRequests(timers: Timers) {
  /** Each outstanding ask or retry, by publication sid, with its timer. */
  const pending = new Map<string, unknown>();
  /** The next retry pause per sid, until the track holds or the publication ends. */
  const pauses = new Map<string, number>();
  /** A held track's timer that, once it has held long enough, forgets its pause. */
  const holds = new Map<string, unknown>();
  let closed = false;
  const cancel = (sid: string) => {
    if (pending.has(sid)) timers.clear(pending.get(sid));
    pending.delete(sid);
  };
  const release = (sid: string) => {
    if (holds.has(sid)) timers.clear(holds.get(sid));
    holds.delete(sid);
  };
  const forget = (sid: string) => {
    cancel(sid);
    release(sid);
    pauses.delete(sid);
  };
  const retry = (sid: string, again: () => void) => {
    // `again` re-evaluates the publication, so a retry for one withdrawn or
    // gone meanwhile asks nothing (and its caller forgets the sid).
    if (closed) return;
    release(sid);
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
        timers.set(() => retry(sid, again), ASK_TIMEOUT_MS),
      );
    },
    /**
     * Ask again after the pause: the SFU refused (including an SDK
     * re-attempt), or a held track was dropped while still published.
     */
    retry,
    /**
     * The track arrived: its answer timeout is moot. Its pause is kept until
     * it has held for as long as that pause, so a flapping track backs off
     * while a stable one starts again from the first pause.
     */
    subscribed(sid: string) {
      cancel(sid);
      release(sid);
      const pauseMs = pauses.get(sid);
      if (closed || pauseMs === undefined) return;
      holds.set(
        sid,
        timers.set(() => {
          holds.delete(sid);
          pauses.delete(sid);
        }, pauseMs),
      );
    },
    /** The publication went away. */
    ended: forget,
    /**
     * The SFU unsubscribed a held track. Our own withdrawal does that too, so
     * only a still-wanted track is asked again (after its pause).
     */
    unsubscribed(sid: string, wanted: boolean, again: () => void) {
      if (wanted) retry(sid, again);
      else forget(sid);
    },
    close() {
      closed = true;
      for (const sid of [...pending.keys(), ...holds.keys()]) forget(sid);
      pauses.clear();
    },
  };
}

/** A participant as far as finding its publications goes. */
type Participant<P> = {
  readonly identity: string;
  readonly trackPublications: ReadonlyMap<string, P>;
};

/**
 * `participant`'s publication `sid`, only while the participant is still the
 * one in the room under its identity: a departed participant keeps its
 * stale publications, which must never be asked for.
 */
export function livePublication<P>(
  inRoom: ReadonlyMap<string, unknown>,
  participant: Participant<P>,
  sid: string,
): P | undefined {
  return inRoom.get(participant.identity) === participant
    ? participant.trackPublications.get(sid)
    : undefined;
}

/**
 * Orders each track's streams: a new stream for a track starts only once
 * its previous stream has fully closed, so a consumer always sees the old
 * stream's close before the new stream's start, and never loses either.
 */
export function createTrackSequencer() {
  const closings = new Map<string, Promise<void>>();
  return {
    /** `trackId`'s stream is closing until `done` settles. */
    closing(trackId: string, done: Promise<unknown>) {
      const settled: Promise<void> = done.then(
        () => undefined,
        () => undefined,
      );
      closings.set(trackId, settled);
      void settled.then(() => {
        if (closings.get(trackId) === settled) closings.delete(trackId);
      });
    },
    /** Runs `start` now, or once `trackId`'s previous stream has closed. */
    whenClosed(trackId: string, start: () => void) {
      const prior = closings.get(trackId);
      if (prior) void prior.then(start);
      else start();
    },
  };
}
