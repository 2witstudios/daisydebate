import type { Waits } from './waits';

/**
 * A monotonic clock the test owns (ADR 0164). Time moves only when the test
 * moves it, so a test of timed work runs in no real time and the same way
 * on every machine. Code under test takes `nowMs`, `sleep` and `waitUntilMs`
 * as injected resources; the test advances time or runs work to its end.
 */
export type VirtualClock = Waits & {
  /**
   * Moves time `ms` forward, waking each sleeper due on the way, soonest
   * first, each once the work it woke can move no further.
   */
  readonly advance: (ms: number) => Promise<void>;
  /**
   * Runs `work` to its end, moving time to the next sleeper whenever the
   * work can move no further. Throws when the work waits with no sleeper
   * left to wake it, since then it would wait forever.
   */
  readonly run: <T>(work: Promise<T>) => Promise<T>;
  /** Lets everything not waiting on time run until it waits. */
  readonly settle: () => Promise<void>;
  /** How many sleepers are waiting. */
  readonly sleepers: () => number;
};

type Sleeper = {
  readonly atMs: number;
  readonly order: number;
  readonly wake: () => void;
};

/**
 * Macrotask turns one settle takes. Each turn drains every microtask first,
 * so a chain of awaits of any length runs within one turn; the further
 * turns let work that itself yields a macrotask (an immediate) run too.
 */
const SETTLE_TURNS = 8;

const nextTurn = () =>
  new Promise<void>((resolve) => {
    setImmediate(resolve);
  });

export function virtualClock(startMs = 0): VirtualClock {
  let now = startMs;
  let order = 0;
  let sleepers: Sleeper[] = [];

  const waitUntilMs = (dueMs: number, signal?: AbortSignal) =>
    new Promise<void>((resolve) => {
      if (signal?.aborted) return resolve();
      const sleeper: Sleeper = {
        atMs: Math.max(dueMs, now),
        order: order++,
        wake: () => {
          signal?.removeEventListener('abort', aborted);
          resolve();
        },
      };
      const aborted = () => {
        sleepers = sleepers.filter((other) => other !== sleeper);
        resolve();
      };
      signal?.addEventListener('abort', aborted, { once: true });
      sleepers.push(sleeper);
    });

  const settle = async () => {
    for (let turn = 0; turn < SETTLE_TURNS; turn += 1) await nextTurn();
  };

  /** The sleeper due first, ties in the order they slept. */
  const soonest = (): Sleeper | undefined =>
    sleepers.reduce<Sleeper | undefined>(
      (best, sleeper) =>
        best === undefined ||
        sleeper.atMs < best.atMs ||
        (sleeper.atMs === best.atMs && sleeper.order < best.order)
          ? sleeper
          : best,
      undefined,
    );

  const wakeSoonest = (): boolean => {
    const next = soonest();
    if (next === undefined) return false;
    sleepers = sleepers.filter((sleeper) => sleeper !== next);
    now = Math.max(now, next.atMs);
    next.wake();
    return true;
  };

  return {
    nowMs: () => now,
    sleep: (ms, signal) => waitUntilMs(now + Math.max(0, ms), signal),
    waitUntilMs,
    settle,
    sleepers: () => sleepers.length,
    advance: async (ms) => {
      const until = now + Math.max(0, ms);
      await settle();
      for (
        let next = soonest();
        next !== undefined && next.atMs <= until;
        next = soonest()
      ) {
        wakeSoonest();
        await settle();
      }
      now = Math.max(now, until);
    },
    run: async <T>(work: Promise<T>): Promise<T> => {
      const outcome = { done: false };
      const finished = work.finally(() => {
        outcome.done = true;
      });
      // A rejection is the caller's to see, from the returned promise.
      finished.catch(() => undefined);
      for (await settle(); !outcome.done; await settle())
        if (!wakeSoonest())
          throw new Error('the work waits with nothing left to wake it');
      return finished;
    },
  };
}
