import { browserScheduler } from './browser-time';

/**
 * Waits shaped for the code that waits, on the browser's timers. Each is
 * handed to a driver as its schedule; none is a timer a component calls.
 */

/** A retry schedule: runs its attempt after the wait `waitMs` gives for how many times it has asked. */
export const retryAfter =
  (waitMs: (asked: number) => number) =>
  (attempt: () => void, asked: number): (() => void) =>
    browserScheduler.after(attempt, waitMs(asked));

/** A fixed cadence: runs its tick every `ms` until cancelled. */
export const repeatEvery =
  (ms: number) =>
  (tick: () => void): (() => void) =>
    browserScheduler.every(tick, ms);

/** A promise that settles after `ms`, for a bounded wait. */
export const pause = (ms: number): Promise<void> =>
  new Promise((done) => {
    browserScheduler.after(done, ms);
  });

/** A deadline: runs `fire` once after `ms`, in the deadline's argument order. */
export const atDeadline = (ms: number, fire: () => void): (() => void) =>
  browserScheduler.after(fire, ms);
