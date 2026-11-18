/** Process-edge one-shot timers: a worker loop's next pass, or a deadline. */
export type OneShotTimer = {
  readonly setTimeout: (run: () => unknown, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
};

/** One-shots plus a monotonic clock: what a worker loop paces itself with. */
export type LoopTimers = OneShotTimer & {
  /** Monotonic milliseconds. */
  readonly now: () => number;
};

/**
 * Process-edge timers for the background workers: one-shots and the clock
 * pace each worker loop (`startWorkerLoop`); intervals keep fixed heartbeats
 * such as lease renewals, which are not polls.
 */
export type WorkerTimers = LoopTimers & {
  readonly setInterval: (task: () => Promise<void>, ms: number) => unknown;
  readonly clearInterval: (handle: unknown) => void;
};
