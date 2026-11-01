import {
  roundMediaAdmissionSchema,
  roundMediaStateSchema,
  type RoundMediaAdmission,
  type RoundMediaState,
} from '@daisy/protocol';

/** The transport's error for a device the Room check passed that is now gone. */
export const CHECKED_DEVICE_MISSING = 'CheckedDeviceMissingError';

export type MediaConnectionState =
  | 'connecting'
  | 'reconnecting'
  | 'live'
  | 'device-missing'
  | 'device-blocked'
  | 'denied'
  | 'unavailable'
  | 'ended';
export type BrowserMediaTransport = {
  readonly connect: (admission: RoundMediaAdmission) => Promise<void>;
  readonly apply: (state: RoundMediaState) => Promise<void>;
  /** Synchronous: a pending getUserMedia or SDK call cannot delay release. */
  readonly stopTracks: () => void;
  readonly disconnect: () => Promise<void>;
};

const transient = new WeakSet<object>();
/**
 * A media request refused for now (a 503 under load, or the network): the
 * controller retries it before calling media unavailable (ISSUE-494).
 */
export function transientMediaFailure() {
  const failure = new Error('Media unavailable for now');
  transient.add(failure);
  return failure;
}
export const isTransientMediaFailure = (error: unknown) =>
  typeof error === 'object' && error !== null && transient.has(error);

/**
 * A definite refusal (a 401/403/404 answer, or a revoked media state): the
 * round never recovers by retrying the same request, so recovery stops.
 */
export class MediaDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MediaDeniedError';
  }
}
export const isMediaDenial = (error: unknown) =>
  error instanceof Error && error.name === 'MediaDeniedError';

/** The HTTP answers whose only meaning is "not allowed here": final. */
const refusedAuthorization = new Set([401, 403, 404]);
/** Temporary refusals: retrying later can succeed without any new decision. */
const refusedForNow = new Set([408, 429, 500, 502, 503, 504]);

/**
 * The failure a non-OK media answer stands for: an authorization refusal
 * (401/403/404) is final denial; a temporary refusal (408/429/5xx) stays
 * transient and paced recovery keeps trying; anything else is a definite
 * failure this session reports without looping.
 */
export function mediaFailure(status: number) {
  if (refusedForNow.has(status)) return transientMediaFailure();
  if (refusedAuthorization.has(status))
    return new MediaDeniedError(`Refused with ${status}`);
  return new Error('Media unavailable');
}

const deviceBlocked = (error: unknown) =>
  error instanceof Error &&
  [
    'NotAllowedError',
    'SecurityError',
    'NotFoundError',
    'NotReadableError',
  ].includes(error.name);

/** One controller per committed Round, independent of competitive command acknowledgement lifetime. */
export function createMediaController(input: {
  readonly roundId: string;
  readonly api: {
    readonly admit: (roundId: string, signal: AbortSignal) => Promise<unknown>;
    readonly reconcile: (
      roundId: string,
      signal: AbortSignal,
    ) => Promise<unknown>;
  };
  readonly transport: () => BrowserMediaTransport;
  readonly changed: (state: MediaConnectionState) => void;
  readonly received?: (state: RoundMediaState) => void;
  /** The one admission whose grant the browser transport now works against. */
  readonly admitted?: (admission: RoundMediaAdmission) => void;
  /** Pauses before each retry of a transient admission failure; none when absent. */
  readonly retry?: {
    readonly delaysMs: readonly number[];
    readonly wait: (ms: number, signal: AbortSignal) => Promise<void>;
  };
  /**
   * The paced-recovery timer edge (ISSUE-880): injected in tests, ambient
   * setTimeout otherwise. One owned handle per controller lifetime.
   */
  readonly recovery?: {
    readonly delaysMs?: readonly number[];
    readonly schedule: (fire: () => void, ms: number) => unknown;
    readonly cancel?: (handle: unknown) => void;
  };
}) {
  let state: MediaConnectionState = 'connecting';
  let ended = false;
  let epoch = 0;
  let abort = new AbortController();
  let transport: BrowserMediaTransport | null = null;
  let reconciling: Promise<void> | null = null;
  let requestedAgain = false;
  const change = (next: MediaConnectionState) => {
    state = next;
    input.changed(next);
  };
  const release = (target: BrowserMediaTransport | null) => {
    if (!target) return;
    target.stopTracks();
    void target.disconnect().catch(() => undefined);
  };
  const stop = () => {
    ended = true;
    epoch++;
    abort.abort();
    cancelRecovery();
    release(transport);
    transport = null;
    change('ended');
  };
  const stale = (generation: number) => ended || generation !== epoch;
  const closeStale = (current: BrowserMediaTransport, generation: number) => {
    if (!stale(generation)) return false;
    release(current);
    return true;
  };
  const announce = (snapshot: RoundMediaState) => input.received?.(snapshot);
  const fail = (
    current: BrowserMediaTransport | null,
    generation: number,
    error: unknown,
  ) => {
    release(current);
    cancelRecovery();
    if (stale(generation)) return;
    transport = null;
    change(
      error instanceof Error && error.name === CHECKED_DEVICE_MISSING
        ? 'device-missing'
        : deviceBlocked(error)
          ? 'device-blocked'
          : isMediaDenial(error)
            ? 'denied'
            : 'unavailable',
    );
    scheduleRecovery(generation);
  };
  /**
   * Paced recovery (ISSUE-880): the delays are the controller's own, and the
   * timer is one owned, generation-guarded, cancellable handle — never an
   * ambient timeout a newer attempt leaves behind.
   */
  const recoveryDelaysMs = input.recovery?.delaysMs ?? [
    1_000, 2_000, 4_000, 8_000, 10_000,
  ];
  let recoveryStep = 0;
  let recoveryTimer: unknown = null;
  /** Cancels the one owned retry timer; every generation change calls this. */
  const cancelRecovery = () => {
    if (recoveryTimer === null) return;
    input.recovery?.cancel?.(recoveryTimer);
    recoveryTimer = null;
  };
  /** Index survives every state change: the backoff must not restart per attempt. */
  const scheduleRecovery = (generation: number) => {
    cancelRecovery();
    if (ended || state !== 'unavailable' || stale(generation)) return;
    const delayMs = recoveryDelaysMs.at(
      Math.min(recoveryStep, recoveryDelaysMs.length - 1),
    );
    if (delayMs === undefined) return;
    recoveryStep++;
    recoveryTimer = schedule(delayMs, () => {
      recoveryTimer = null;
      // A timer from an older generation is inert even if the newer attempt
      // failed again: only this generation's own timer may rejoin.
      if (ended || generation !== epoch || state !== 'unavailable') return;
      void join(true);
    });
  };
  /** The one scheduling edge: injected in tests, ambient timers otherwise. */
  const schedule = (delayMs: number, fire: () => void): unknown => {
    const scheduler = input.recovery;
    if (scheduler) return scheduler.schedule(fire, delayMs);
    return setTimeout(fire, delayMs);
  };
  /** One media request, retried through the configured pauses while it fails transiently. */
  const retrying = async (
    generation: number,
    request: () => Promise<unknown>,
    pausing: () => void,
  ) => {
    for (const pauseMs of input.retry?.delaysMs ?? [])
      try {
        return await request();
      } catch (error) {
        if (!isTransientMediaFailure(error) || stale(generation)) throw error;
        pausing();
        await input.retry!.wait(pauseMs, abort.signal);
        if (stale(generation)) throw error;
      }
    return request();
  };
  const synchronize = async (
    current: BrowserMediaTransport,
    generation: number,
    pausing: () => void,
  ) => {
    const snapshot = roundMediaStateSchema.parse(
      await retrying(
        generation,
        () => input.api.reconcile(input.roundId, abort.signal),
        pausing,
      ),
    );
    if (closeStale(current, generation)) return false;
    if (snapshot.roundId !== input.roundId)
      throw new Error('Media Round mismatch');
    if (snapshot.state === 'ended') {
      stop();
      return false;
    }
    if (snapshot.state !== 'ready')
      throw new MediaDeniedError('The Round withdrew its media');
    await current.apply(snapshot);
    if (closeStale(current, generation)) return false;
    announce(snapshot);
    return true;
  };
  const join = async (reconnect = false) => {
    if (ended) return;
    const generation = ++epoch;
    abort.abort();
    abort = new AbortController();
    cancelRecovery();
    release(transport);
    transport = null;
    change(reconnect ? 'reconnecting' : 'connecting');
    let current: BrowserMediaTransport | null = null;
    try {
      const joining = () => change('reconnecting');
      const admission = roundMediaAdmissionSchema.parse(
        await retrying(
          generation,
          () => input.api.admit(input.roundId, abort.signal),
          joining,
        ),
      );
      if (stale(generation)) return;
      if (admission.roundId !== input.roundId)
        throw new Error('Media Round mismatch');
      input.admitted?.(admission);
      current = input.transport();
      transport = current;
      await current.connect(admission);
      if (closeStale(current, generation)) return;
      if (!(await synchronize(current, generation, joining))) return;
      recoveryStep = 0;
      cancelRecovery();
      change('live');
    } catch (error) {
      fail(current, generation, error);
    }
  };
  const reconcile = () => {
    if (ended || !transport || state !== 'live') return Promise.resolve();
    requestedAgain = true;
    if (reconciling) return reconciling;
    reconciling = (async () => {
      while (requestedAgain && !ended && transport) {
        requestedAgain = false;
        const generation = epoch,
          current = transport;
        try {
          // Live tracks stay published while a read refused for now is retried.
          if (!(await synchronize(current, generation, () => undefined)))
            return;
        } catch (error) {
          fail(current, generation, error);
          return;
        }
      }
    })().finally(() => {
      reconciling = null;
    });
    return reconciling;
  };
  return {
    state: () => state,
    join: () => join(),
    reconnect: () => join(true),
    reconcile,
    stop,
  };
}
