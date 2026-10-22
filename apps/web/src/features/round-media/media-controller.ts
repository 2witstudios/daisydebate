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
  const join = async (reconnect = false) => {
    if (ended) return;
    const generation = ++epoch;
    abort.abort();
    abort = new AbortController();
    release(transport);
    transport = null;
    change(reconnect ? 'reconnecting' : 'connecting');
    let current: BrowserMediaTransport | null = null;
    let devices = false;
    const stale = () => ended || generation !== epoch;
    try {
      const admission = roundMediaAdmissionSchema.parse(
        await input.api.admit(input.roundId, abort.signal),
      );
      if (stale()) return;
      if (admission.roundId !== input.roundId)
        throw new Error('Media Round mismatch');
      current = input.transport();
      transport = current;
      await current.connect(admission);
      if (stale()) {
        release(current);
        return;
      }
      const snapshot = roundMediaStateSchema.parse(
        await input.api.reconcile(input.roundId, abort.signal),
      );
      if (stale()) {
        release(current);
        return;
      }
      if (snapshot.roundId !== input.roundId)
        throw new Error('Media Round mismatch');
      if (snapshot.state === 'ended') {
        stop();
        return;
      }
      if (snapshot.state !== 'ready') throw new Error('Media unavailable');
      devices = true;
      await current.apply(snapshot);
      if (stale()) {
        release(current);
        return;
      }
      input.received?.(snapshot);
      change('live');
    } catch {
      release(current);
      if (!stale()) {
        transport = null;
        change(devices ? 'device-blocked' : 'unavailable');
      }
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
          const snapshot = roundMediaStateSchema.parse(
            await input.api.reconcile(input.roundId, abort.signal),
          );
          if (ended || generation !== epoch) return;
          if (snapshot.roundId !== input.roundId)
            throw new Error('Media Round mismatch');
          if (snapshot.state === 'ended') {
            stop();
            return;
          }
          if (snapshot.state !== 'ready') {
            release(current);
            transport = null;
            change('unavailable');
            return;
          }
          await current.apply(snapshot);
          if (ended || generation !== epoch) {
            release(current);
            return;
          }
          input.received?.(snapshot);
        } catch {
          release(current);
          if (!ended && generation === epoch) {
            transport = null;
            change('unavailable');
          }
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
