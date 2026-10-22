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
  const synchronize = async (
    current: BrowserMediaTransport,
    generation: number,
  ) => {
    const snapshot = roundMediaStateSchema.parse(
      await input.api.reconcile(input.roundId, abort.signal),
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
      const admission = roundMediaAdmissionSchema.parse(
        await input.api.admit(input.roundId, abort.signal),
      );
      if (stale(generation)) return;
      if (admission.roundId !== input.roundId)
        throw new Error('Media Round mismatch');
      current = input.transport();
      transport = current;
      await current.connect(admission);
      if (closeStale(current, generation)) return;
      if (!(await synchronize(current, generation))) return;
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
          if (!(await synchronize(current, generation))) return;
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
