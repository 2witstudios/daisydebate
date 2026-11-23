import type { Waits } from '@daisy/clock';
import { virtualClock } from '@daisy/clock/testing';

type Sleeper = {
  readonly atMs: number;
  /** How long the wait was when it was armed. */
  readonly ms: number;
  readonly wake: () => void;
};

/** Lets every queued turn run: a woken loop runs until it waits again. */
const settle = async () => {
  for (let turn = 0; turn < 8; turn += 1)
    await new Promise((resolve) => setImmediate(resolve));
};

/**
 * Injected time fired by hand. Each wait is armed under its length; a test
 * fires the one armed with a given length (`tasks.get(ms)`), or the first
 * armed (`nextPass`). Firing moves the clock to that wait's end, wakes it,
 * and lets the work it woke run until it waits again. `armed` lists every
 * wait's length, in order.
 */
export function manualWaits() {
  let clock = 0;
  const sleepers = new Set<Sleeper>();
  const armed: number[] = [];
  const waitUntilMs = (dueMs: number, signal?: AbortSignal) =>
    new Promise<void>((resolve) => {
      if (signal?.aborted) return resolve();
      const aborted = () => sleeper.wake();
      const sleeper: Sleeper = {
        atMs: dueMs,
        ms: Math.max(0, dueMs - clock),
        wake: () => {
          sleepers.delete(sleeper);
          signal?.removeEventListener('abort', aborted);
          resolve();
        },
      };
      signal?.addEventListener('abort', aborted, { once: true });
      sleepers.add(sleeper);
      armed.push(sleeper.ms);
    });
  const waits: Waits = {
    nowMs: () => clock,
    waitUntilMs,
    sleep: (ms, signal) => waitUntilMs(clock + Math.max(0, ms), signal),
  };
  const fire = async (sleeper: Sleeper) => {
    clock = Math.max(clock, sleeper.atMs);
    sleeper.wake();
    await settle();
  };
  const armedFor = (ms: number) =>
    [...sleepers].find((sleeper) => sleeper.ms === ms);
  return {
    waits,
    armed,
    settle,
    /** The wait armed with `ms`, to fire; undefined when none is. */
    tasks: {
      get: (ms: number) => {
        const sleeper = armedFor(ms);
        return sleeper === undefined ? undefined : () => fire(sleeper);
      },
      has: (ms: number) => armedFor(ms) !== undefined,
    },
    /** Fires the first wait armed, whatever its length. */
    nextPass: async () => {
      await settle();
      const [sleeper] = sleepers;
      if (sleeper === undefined) throw new Error('No worker pass armed');
      await fire(sleeper);
    },
    /** Moves the clock without firing anything, as time passing mid-pass. */
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

/** Records each worker failure as [error, stage]. */
export function failureLog() {
  const failures: unknown[] = [];
  return {
    failures,
    failed: (error: unknown, stage: string) => {
      failures.push([error, stage]);
    },
  };
}

/** Time that never moves: a worker runs only its start-up pass. */
export const inertWaits: Waits = virtualClock();
