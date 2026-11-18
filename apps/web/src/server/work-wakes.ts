import type { WorkKind } from '@daisy/db';
import type { WorkWake } from '../lib/worker-loop';
import type { OneShotTimer } from '../lib/worker-timers';

/**
 * The process's worker wakes (ADR 0154): each worker loop subscribes to the
 * kinds of work it looks for; a NOTIFY on `daisy_work` wakes those loops,
 * and a (re)established LISTEN wakes every loop once, since notifications
 * sent while it was down are lost.
 */
export function createWorkWakes() {
  const listeners = new Map<WorkKind, Set<() => void>>();
  const call = (kind: WorkKind) => {
    for (const listener of listeners.get(kind) ?? []) listener();
  };
  return {
    of: (...kinds: readonly WorkKind[]): WorkWake => ({
      subscribe: (listener) => {
        for (const kind of kinds) {
          const set = listeners.get(kind) ?? new Set();
          set.add(listener);
          listeners.set(kind, set);
        }
        return () => {
          for (const kind of kinds) listeners.get(kind)?.delete(listener);
        };
      },
    }),
    wake: call,
    wakeAll: () => {
      const every = new Set([...listeners.values()].flatMap((set) => [...set]));
      for (const listener of every) listener();
    },
  };
}
export type WorkWakes = ReturnType<typeof createWorkWakes>;

/** The first retry of a LISTEN that could not start; it doubles to a minute. */
const LISTEN_RETRY_MS = 1_000;
const LISTEN_RETRY_CAP_MS = 60_000;

/** A cause code a log field admits: the error's class name, never its message. */
const causeOf = (error: unknown) =>
  error instanceof Error && /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(error.name)
    ? error.name
    : 'unknown';

/**
 * Keeps the work-wake LISTEN up: a subscribe that fails (a database briefly
 * unreachable at boot) is reported with its cause and tried again after 1 s,
 * doubling to a minute, so wakes come back without a restart. Until then
 * every loop still runs at its idle cap.
 */
export function keepWorkWakesListening(input: {
  readonly subscribe: () => Promise<{ readonly unlisten: () => Promise<void> }>;
  readonly unavailable: (cause: string) => void;
  readonly timers: OneShotTimer;
}) {
  let stopped = false;
  let handle: unknown = null;
  let subscription: { readonly unlisten: () => Promise<void> } | null = null;
  let attempt: Promise<void> = Promise.resolve();
  const tryListen = (waitMs: number): Promise<void> =>
    input.subscribe().then(
      async (listening) => {
        if (stopped) await listening.unlisten();
        else subscription = listening;
      },
      (error: unknown) => {
        if (stopped) return;
        input.unavailable(causeOf(error));
        handle = input.timers.setTimeout(() => {
          handle = null;
          attempt = tryListen(Math.min(LISTEN_RETRY_CAP_MS, waitMs * 2));
        }, waitMs);
      },
    );
  attempt = tryListen(LISTEN_RETRY_MS);
  return {
    async stop() {
      stopped = true;
      if (handle !== null) input.timers.clearTimeout(handle);
      await attempt;
      await subscription?.unlisten();
    },
  };
}
