/**
 * The browser's timer queue as one port. Outside the edge it is injected
 * into the code that waits, never called: a component waits through
 * `useTick` or `useDelay`, a driver through the scheduler it was given.
 * Each wait answers its own cancellation. The window's own timers are read
 * at each call, so a realm a test installs is the one that runs.
 */
export type BrowserScheduler = {
  /** Runs once after `ms`. */
  readonly after: (run: () => void, ms: number) => () => void;
  /** Runs every `ms` until cancelled. */
  readonly every: (run: () => void, ms: number) => () => void;
  /** Runs before the next paint. */
  readonly frame: (run: () => void) => () => void;
};

export const browserScheduler: BrowserScheduler = {
  after(run, ms) {
    const timer = window.setTimeout(run, ms);
    return () => window.clearTimeout(timer);
  },
  every(run, ms) {
    const timer = window.setInterval(run, ms);
    return () => window.clearInterval(timer);
  },
  frame(run) {
    const frame = window.requestAnimationFrame(() => run());
    return () => window.cancelAnimationFrame(frame);
  },
};

/** A handle-shaped timer pair, for consumers whose contract holds the handle. */
export type HandleTimers = {
  readonly set: (run: () => void, ms: number) => unknown;
  readonly clear: (handle: unknown) => void;
};

export const browserHandleTimers: HandleTimers = {
  set: (run, ms) => window.setTimeout(run, ms),
  clear: (handle) => window.clearTimeout(handle as number),
};
