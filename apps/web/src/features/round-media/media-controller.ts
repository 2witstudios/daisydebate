import { cancelMediaWork } from './cancel-media-work';
import {
  failureKind,
  failureState,
  isMediaRefusal,
  isTransientMediaFailure,
  mediaRefusal,
  type MediaFailureKind,
} from './media-failure';
import {
  decideMediaRead,
  decideSupersededRead,
  type MediaReadEvent,
  type MediaReadIntent,
} from './media-read-intent';
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
  /** Tracks stay up, but no recent server read confirms what is shown. */
  | 'out-of-date'
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

type ReadTicket = {
  readonly generation: number;
  readonly abort: AbortController;
  readonly startedAtMs: number;
};
type Connection = {
  readonly generation: number;
  readonly signal: AbortSignal;
  readonly transport: BrowserMediaTransport;
  connected: boolean;
  wentLive: boolean;
  /** A local device failure the Round already shows; reads must not overwrite it. */
  deviceFailed: boolean;
  unansweredSinceMs: number | null;
  supersededSinceAnswer: number;
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
  readonly changed: (
    state: MediaConnectionState,
    failure?: MediaFailureKind,
  ) => void;
  readonly received?: (state: RoundMediaState) => void;
  /** The last answer is no longer current; `received` reports the next one. */
  readonly superseded?: () => void;
  /** How long reads may go unanswered before live tracks show as out of date. */
  readonly readBudget?: { readonly now: () => number; readonly ms: number };
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
  const change = (next: MediaConnectionState, failure?: MediaFailureKind) => {
    state = next;
    input.changed(next, failure);
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
    const previous = connection;
    connection = null;
    release(previous?.transport ?? null);
    change('ended');
  };
  const fail = (
    generation: number,
    error: unknown,
    failure: MediaFailureKind = failureKind(error),
  ) => {
    if (stale(generation)) return;
    const previous = connection;
    connection = null;
    release(previous?.transport ?? null);
    if (!stale(generation)) change(failureState(error), failure);
  };
  const retrying = async (
    signal: AbortSignal,
    request: () => Promise<unknown>,
    pausing: () => void,
    wanted: () => boolean = () => true,
  ) => {
    for (const pauseMs of input.retry?.delaysMs ?? []) {
      try {
        return await cancelMediaWork(signal, request);
      } catch (error) {
        if (signal.aborted || !wanted() || !isTransientMediaFailure(error))
          throw error;
        pausing();
        await cancelMediaWork(signal, () => input.retry!.wait(pauseMs, signal));
        // A read let finish is not aborted, but must not spend another attempt.
        if (!wanted()) throw error;
      }
    }
    return cancelMediaWork(signal, request);
  };
  /** The server's answer, or null once an unanswered read has been dealt with. */
  const readAnswer = async (owner: Connection, ticket: ReadTicket) => {
    const signal = ticket.abort.signal;
    try {
      const snapshot = roundMediaStateSchema.parse(
        await retrying(
          signal,
          () => input.api.reconcile(input.roundId, signal),
          () => {
            if (current(owner, ticket) && !owner.wentLive)
              change('reconnecting');
          },
          () => current(owner, ticket),
        ),
      );
      if (current(owner, ticket) && snapshot.roundId !== input.roundId)
        throw new Error('Media Round mismatch');
      return snapshot;
    } catch (error) {
      if (current(owner, ticket)) readUnanswered(owner, error);
      return null;
    }
  };
  const synchronize = async (owner: Connection, ticket: ReadTicket) => {
    const signal = ticket.abort.signal;
    const snapshot = await readAnswer(owner, ticket);
    if (!snapshot || !current(owner, ticket)) return;
    if (snapshot.state === 'ended') {
      stop();
      return;
    }
    if (snapshot.state !== 'ready') {
      fail(owner.generation, mediaRefusal());
      return;
    }
    // A started SDK operation cannot be cancelled. Fresh HTTP may run while it
    // finishes, but fresh SDK application must follow its actual settlement.
    const applying = owner.applying.then(async () => {
      if (!current(owner, ticket)) return;
      try {
        await owner.transport.apply(snapshot);
      } finally {
        if (!active(owner)) release(owner.transport);
      }
    });
    owner.applying = applying.catch(() => undefined);
    await cancelMediaWork(signal, () => applying);
    if (!current(owner, ticket)) return;
    input.received?.(snapshot);
    if (!current(owner, ticket)) return;
    owner.wentLive = true;
    owner.unansweredSinceMs = null;
    owner.supersededSinceAnswer = 0;
    if (state !== 'live' && !owner.deviceFailed) change('live');
  };
  const showOutOfDate = (owner: Connection) => {
    if (!owner.deviceFailed) change('out-of-date', 'transient');
  };
  /**
   * LiveKit enforces every grant on the server, so a read that cannot finish
   * carries no authority risk: live tracks stay up and the next event reads again.
   */
  const readUnanswered = (owner: Connection, error: unknown) => {
    if (isMediaRefusal(error)) fail(owner.generation, error);
    else if (owner.wentLive) showOutOfDate(owner);
    else fail(owner.generation, error);
  };
  /** Supersession restarts each read's retries, not the stall it belongs to. */
  const noteReadStarting = (owner: Connection) => {
    const budget = input.readBudget;
    if (!budget) return;
    owner.unansweredSinceMs ??= budget.now();
    if (
      owner.wentLive &&
      state === 'live' &&
      budget.now() - owner.unansweredSinceMs >= budget.ms
    )
      showOutOfDate(owner);
  };
  const drain = async (owner: Connection) => {
    // Yield first so `owner.loop` is reserved before effects can emit an intent.
    await Promise.resolve();
    while (owner.queued && active(owner)) {
      owner.queued = false;
      const ticket: ReadTicket = {
        generation: intent.generation,
        abort: new AbortController(),
        startedAtMs: input.readBudget?.now() ?? 0,
      };
      owner.read = ticket;
      noteReadStarting(owner);
      const cancel = () => ticket.abort.abort();
      owner.signal.addEventListener('abort', cancel, { once: true });
      try {
        await synchronize(owner, ticket);
      } catch (error) {
        if (current(owner, ticket)) fail(owner.generation, error);
      } finally {
        owner.signal.removeEventListener('abort', cancel);
        owner.read = null;
      }
    }
    owner.loop = null;
  };
  /** One drain per connection, so a ticket's cleanup can never touch a successor. */
  const read = (owner: Connection) => {
    owner.queued = true;
    owner.loop ??= drain(owner);
    return owner.loop;
  };
  const open = async (
    generation: number,
    signal: AbortSignal,
    admission: RoundMediaAdmission,
  ) => {
    const owner: Connection = {
      generation,
      signal,
      transport: input.transport(),
      connected: false,
      wentLive: false,
      deviceFailed: false,
      unansweredSinceMs: null,
      supersededSinceAnswer: 0,
      queued: false,
      read: null,
      loop: null,
      applying: Promise.resolve(),
    };
    // `input.transport()` is caller code and may stop or replace this join.
    if (stale(generation)) {
      release(owner.transport);
      return;
    }
    connection = owner;
    const connecting = owner.transport.connect(admission);
    void connecting
      .finally(() => {
        if (!active(owner)) release(owner.transport);
      })
      .catch(() => undefined);
    await cancelMediaWork(signal, () => connecting);
    if (!active(owner)) return;
    owner.connected = true;
    await read(owner);
  };
  const admit = async (generation: number, signal: AbortSignal) => {
    const admission = roundMediaAdmissionSchema.parse(
      await retrying(
        signal,
        () => input.api.admit(input.roundId, signal),
        () => {
          if (!stale(generation)) change('reconnecting');
        },
      ),
    );
    if (!stale(generation) && admission.roundId !== input.roundId)
      throw new Error('Media Round mismatch');
    return admission;
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
    try {
      const admission = await admit(generation, signal);
      if (stale(generation)) return;
      await open(generation, signal, admission);
    } catch (error) {
      fail(generation, error);
    }
  };
  /** The ticket is already stale here, so its reply cannot apply either way. */
  const supersedeRead = (owner: Connection) => {
    const inFlight = owner.read;
    if (!inFlight) return;
    const budget = input.readBudget;
    const pacing = budget
      ? decideSupersededRead({
          supersededSinceAnswer: owner.supersededSinceAnswer,
          readAgeMs: budget.now() - inFlight.startedAtMs,
        })
      : 'abort';
    owner.supersededSinceAnswer++;
    if (pacing === 'abort') inFlight.abort.abort();
  };
  const reconcile = (event: MediaReadEvent) => {
    const decision = decideMediaRead(intent, event);
    if (decision.action === 'ignore') return Promise.resolve();
    intent = decision.intent;
    const owner = connection;
    if (decision.action === 'supersede') {
      if (owner) supersedeRead(owner);
      input.superseded?.();
    }
    if (!owner || !active(owner)) return Promise.resolve();
    if (!owner.connected) return Promise.resolve();
    return read(owner);
  };
  return {
    state: () => state,
    /** The Round showed a local device failure; later reads must not hide it. */
    deviceFailed: () => {
      if (connection) connection.deviceFailed = true;
    },
    join: () => join(),
    reconnect: () => join(true),
    reconcile,
    stop,
  };
}
