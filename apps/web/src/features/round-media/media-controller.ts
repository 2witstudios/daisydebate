import {
  roundMediaAdmissionSchema,
  roundMediaStateSchema,
  type RoundMediaAdmission,
  type RoundMediaState,
} from '@daisy/protocol';

export type MediaConnectionState =
  | 'connecting'
  | 'reconnecting'
  | 'live'
  | 'device-blocked'
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
 * The failure a non-OK media answer stands for: a 408 (the outcome is unknown)
 * or a 503 (refused for now) is transient; every other status is definite.
 */
export function mediaFailure(status: number) {
  return status === 408 || status === 503
    ? transientMediaFailure()
    : new Error('Media unavailable');
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
  /** Pauses before each retry of a transient admission failure; none when absent. */
  readonly retry?: {
    readonly delaysMs: readonly number[];
    readonly wait: (ms: number, signal: AbortSignal) => Promise<void>;
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
    if (stale(generation)) return;
    transport = null;
    change(deviceBlocked(error) ? 'device-blocked' : 'unavailable');
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
    if (snapshot.state !== 'ready') throw new Error('Media unavailable');
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
      current = input.transport();
      transport = current;
      await current.connect(admission);
      if (closeStale(current, generation)) return;
      if (!(await synchronize(current, generation, joining))) return;
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
