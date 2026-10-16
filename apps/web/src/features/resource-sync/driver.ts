import type { ConnectionStore, Scheduler } from '../realtime/connection-store';
import {
  resourceSync,
  shouldRead,
  type ResourceEvent,
  type ResourceIdentity,
  type ResourceSync,
} from './resource-sync';

/**
 * Backstop reads. While a doorbell can ring (the realtime connection is
 * open) a current resource still looks every thirty seconds, because
 * doorbells have no delivery guarantee yet. Without one (no realtime, not
 * yet open, dropped) or while stale, it looks every five.
 */
export const RESOURCE_POLL_MS = { doorbell: 30000, alone: 5000 } as const;

/** What a read answers; a thrown read counts as `unavailable`. */
export type ResourceRead<T> =
  | { readonly kind: 'found'; readonly value: T }
  | { readonly kind: 'missing' | 'unavailable' };

/** A subscribed doorbell: retried after an authorized read, then closed. */
export type Doorbell = {
  readonly authorizedSnapshot: () => void;
  readonly close: () => void;
};

export type SyncConnection = Pick<
  ConnectionStore,
  | 'subscribeTopic'
  | 'onMessage'
  | 'resubscribeTopic'
  | 'subscribe'
  | 'connect'
  | 'close'
>;

export type SyncVisibility = {
  readonly isVisible: () => boolean;
  /** Calls back when the tab becomes visible; returns a release. */
  readonly onVisible: (listener: () => void) => () => void;
};

/**
 * The side effects of resource sync (ADR 0066): doorbells, reads, timers,
 * tab visibility and the realtime connection become reducer events, and
 * nothing else. Every transition is `resourceSync`'s; a failed read is an
 * event, never an exception.
 */
export function createResourceSyncDriver<T>({
  identity,
  seed,
  read,
  scheduler,
  visibility,
  connection,
  doorbell,
  deadline = () => null,
}: {
  readonly identity: ResourceIdentity<T>;
  readonly seed: ResourceSync<T>;
  readonly read: () => Promise<ResourceRead<T>>;
  readonly scheduler: Scheduler;
  readonly visibility: SyncVisibility;
  readonly connection: SyncConnection | null;
  readonly doorbell: (
    connection: SyncConnection,
    signal: (version: number | null) => void,
  ) => Doorbell;
  /** When the held value goes out of date by itself, if it does. */
  readonly deadline?: (state: ResourceSync<T>) => number | null;
}) {
  const transition = resourceSync(identity);
  let state = seed;
  let disposed = false;
  const listeners = new Set<() => void>();
  let poll: unknown = null;
  /** The realtime connection is open, so a doorbell can ring. */
  let ringing = false;
  let timedOut: { readonly at: number; readonly timer: unknown } | null = null;
  /** A deadline fires once; until a read moves it, the backstop paces retries. */
  let firedAt: number | null = null;

  const armPoll = () => {
    if (poll !== null) scheduler.clearTimeout(poll);
    poll = scheduler.setTimeout(
      () => {
        poll = null;
        if (visibility.isVisible()) signal(null);
        if (poll === null) armPoll();
      },
      ringing && state.freshness === 'current'
        ? RESOURCE_POLL_MS.doorbell
        : RESOURCE_POLL_MS.alone,
    );
  };
  const armDeadline = () => {
    const at = deadline(state);
    if (timedOut?.at === at || (at !== null && at === firedAt)) return;
    if (timedOut) scheduler.clearTimeout(timedOut.timer);
    timedOut =
      at === null
        ? null
        : {
            at,
            timer: scheduler.setTimeout(
              () => {
                timedOut = null;
                firedAt = at;
                signal(null);
              },
              Math.max(0, at - scheduler.now()),
            ),
          };
  };
  const dispatch = (event: ResourceEvent<T>) => {
    if (disposed) return;
    const before = state;
    state = transition(state, event);
    if (state !== before) for (const listener of listeners) listener();
    armDeadline();
    if (shouldRead(state)) void readOnce();
  };
  const readOnce = async () => {
    dispatch({ type: 'read' });
    let answer: ResourceRead<T>;
    try {
      answer = await read();
    } catch {
      answer = { kind: 'unavailable' };
    }
    if (disposed) return;
    if (answer.kind === 'found') {
      dispatch({ type: 'found', value: answer.value, at: scheduler.now() });
      bell?.authorizedSnapshot();
    } else dispatch({ type: answer.kind });
    armPoll();
  };
  const signal = (version: number | null) =>
    dispatch({ type: 'signal', version });

  const bell = connection ? doorbell(connection, signal) : null;
  let opened: number | null = null;
  const stopConnection = connection?.subscribe((next) => {
    const open = next.status === 'open' && next.terminal === null;
    if (open !== ringing) {
      ringing = open;
      armPoll();
    }
    if (next.terminal !== null) signal(null);
    else if (open) {
      if (opened !== null && opened !== next.generation) signal(null);
      opened = next.generation;
    }
  });
  connection?.connect();
  const stopVisibility = visibility.onVisible(() => signal(null));
  armPoll();
  armDeadline();

  return {
    readSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Something suggests the resource moved: a refused command, say. */
    signal: () => signal(null),
    /** A command's canonical answer: adopted without another read. */
    accepted: (value: T) =>
      dispatch({ type: 'accepted', value, at: scheduler.now() }),
    dispose() {
      if (disposed) return;
      disposed = true;
      listeners.clear();
      bell?.close();
      stopConnection?.();
      connection?.close();
      stopVisibility();
      if (poll !== null) scheduler.clearTimeout(poll);
      if (timedOut) scheduler.clearTimeout(timedOut.timer);
      poll = null;
      timedOut = null;
    },
  };
}
