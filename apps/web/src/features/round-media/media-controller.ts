import { cancelMediaWork } from './cancel-media-work';
import {
  decideMediaRead,
  type MediaReadEvent,
  type MediaReadIntent,
} from './media-read-intent';
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

type ReadTicket = {
  readonly generation: number;
  readonly abort: AbortController;
};
type Connection = {
  readonly generation: number;
  readonly signal: AbortSignal;
  readonly transport: BrowserMediaTransport;
  connected: boolean;
  queued: boolean;
  read: ReadTicket | null;
  loop: Promise<void> | null;
  applying: Promise<void>;
};

/** One connection per committed Round, with independently supersedable read intents. */
export function createMediaController(input: {
  readonly roundId: string;
  readonly initialRoundViewVersion: number;
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
  readonly retry?: {
    readonly delaysMs: readonly number[];
    readonly wait: (ms: number, signal: AbortSignal) => Promise<void>;
  };
}) {
  if (
    !Number.isSafeInteger(input.initialRoundViewVersion) ||
    input.initialRoundViewVersion < 0
  )
    throw new Error('Invalid initial Round view version');
  let intent: MediaReadIntent = {
    roundViewVersion: input.initialRoundViewVersion,
    deadlineMs: null,
    generation: 0,
    disposed: false,
  };
  let state: MediaConnectionState = 'connecting';
  let epoch = 0;
  let abort = new AbortController();
  let connection: Connection | null = null;
  const change = (next: MediaConnectionState) => {
    state = next;
    input.changed(next);
  };
  const release = (target: BrowserMediaTransport | null) => {
    if (!target) return;
    target.stopTracks();
    void target.disconnect().catch(() => undefined);
  };
  const stale = (generation: number) => intent.disposed || generation !== epoch;
  const active = (owner: Connection) =>
    !stale(owner.generation) && connection === owner;
  const current = (owner: Connection, ticket: ReadTicket) =>
    active(owner) &&
    !ticket.abort.signal.aborted &&
    ticket.generation === intent.generation;
  const stop = () => {
    if (intent.disposed) return;
    intent = decideMediaRead(intent, { kind: 'dispose' }).intent;
    epoch++;
    abort.abort();
    connection?.read?.abort.abort();
    const previous = connection;
    connection = null;
    release(previous?.transport ?? null);
    change('ended');
  };
  const fail = (
    owner: Connection | null,
    generation: number,
    error: unknown,
  ) => {
    if (stale(generation)) return;
    connection = null;
    release(owner?.transport ?? null);
    if (stale(generation)) return;
    change(
      error instanceof Error && error.name === CHECKED_DEVICE_MISSING
        ? 'device-missing'
        : deviceBlocked(error)
          ? 'device-blocked'
          : 'unavailable',
    );
  };
  const retrying = async (
    signal: AbortSignal,
    request: () => Promise<unknown>,
    pausing: () => void,
  ) => {
    for (const pauseMs of input.retry?.delaysMs ?? []) {
      try {
        return await cancelMediaWork(signal, request);
      } catch (error) {
        if (signal.aborted || !isTransientMediaFailure(error)) throw error;
        pausing();
        await cancelMediaWork(signal, () => input.retry!.wait(pauseMs, signal));
      }
    }
    return cancelMediaWork(signal, request);
  };
  const synchronize = async (owner: Connection, ticket: ReadTicket) => {
    const signal = ticket.abort.signal;
    const snapshot = roundMediaStateSchema.parse(
      await retrying(
        signal,
        () => input.api.reconcile(input.roundId, signal),
        () => {
          if (current(owner, ticket) && state !== 'live')
            change('reconnecting');
        },
      ),
    );
    if (!current(owner, ticket)) return;
    if (snapshot.roundId !== input.roundId)
      throw new Error('Media Round mismatch');
    if (snapshot.state === 'ended') {
      stop();
      return;
    }
    if (snapshot.state !== 'ready') throw new Error('Media unavailable');
    // A started SDK operation cannot be cancelled. Fresh HTTP may run while it
    // finishes, but fresh SDK application must follow its actual settlement.
    const applying = owner.applying.then(async () => {
      if (!current(owner, ticket)) return;
      try {
        await owner.transport.apply(snapshot);
      } finally {
        if (stale(owner.generation)) release(owner.transport);
      }
    });
    owner.applying = applying.catch(() => undefined);
    await cancelMediaWork(signal, () => applying);
    if (!current(owner, ticket)) return;
    input.received?.(snapshot);
    if (current(owner, ticket) && state !== 'live') change('live');
  };
  const read = (owner: Connection): Promise<void> => {
    owner.queued = true;
    if (owner.loop) return owner.loop;
    // Reserve the loop before effects can synchronously emit another intent.
    const loop = Promise.resolve()
      .then(async () => {
        while (owner.queued && active(owner) && owner.connected) {
          owner.queued = false;
          const ticket: ReadTicket = {
            generation: intent.generation,
            abort: new AbortController(),
          };
          owner.read = ticket;
          const cancel = () => ticket.abort.abort();
          owner.signal.addEventListener('abort', cancel, { once: true });
          try {
            await synchronize(owner, ticket);
          } catch (error) {
            if (current(owner, ticket)) fail(owner, owner.generation, error);
          } finally {
            owner.signal.removeEventListener('abort', cancel);
            if (owner.read === ticket) owner.read = null;
          }
        }
      })
      .finally(() => {
        if (owner.loop !== loop) return;
        owner.loop = null;
        // A wake can arrive after the loop exits but before this finally runs.
        if (owner.queued && active(owner) && owner.connected)
          return read(owner);
      });
    owner.loop = loop;
    return loop;
  };
  const join = async (reconnect = false) => {
    if (intent.disposed) return;
    const generation = ++epoch;
    abort.abort();
    if (stale(generation)) return;
    abort = new AbortController();
    const signal = abort.signal;
    const previous = connection;
    connection = null;
    release(previous?.transport ?? null);
    if (stale(generation)) return;
    change(reconnect ? 'reconnecting' : 'connecting');
    let owner: Connection | null = null;
    try {
      const admission = roundMediaAdmissionSchema.parse(
        await retrying(
          signal,
          () => input.api.admit(input.roundId, signal),
          () => {
            if (!stale(generation)) change('reconnecting');
          },
        ),
      );
      if (stale(generation)) return;
      if (admission.roundId !== input.roundId)
        throw new Error('Media Round mismatch');
      owner = {
        generation,
        signal,
        transport: input.transport(),
        connected: false,
        queued: false,
        read: null,
        loop: null,
        applying: Promise.resolve(),
      };
      if (stale(generation)) {
        release(owner.transport);
        return;
      }
      connection = owner;
      const target = owner;
      const connecting = target.transport.connect(admission);
      void connecting
        .finally(() => {
          if (stale(generation)) release(target.transport);
        })
        .catch(() => undefined);
      await cancelMediaWork(signal, () => connecting);
      if (!active(owner)) return;
      owner.connected = true;
      await read(owner);
    } catch (error) {
      fail(owner, generation, error);
    }
  };
  const reconcile = (event: MediaReadEvent) => {
    const decision = decideMediaRead(intent, event);
    if (decision.action === 'ignore') return Promise.resolve();
    intent = decision.intent;
    const owner = connection;
    if (decision.action === 'supersede') owner?.read?.abort.abort();
    if (!owner || !active(owner)) return Promise.resolve();
    if (!owner.connected) {
      owner.queued = true;
      return Promise.resolve();
    }
    return read(owner);
  };
  return {
    state: () => state,
    join: () => join(),
    reconnect: () => join(true),
    reconcile,
    stop,
  };
}
