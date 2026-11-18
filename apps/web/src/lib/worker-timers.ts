/** Process-edge one-shot timers: a worker loop's next pass, or a deadline. */
export type OneShotTimer = {
  readonly setTimeout: (run: () => unknown, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
};

/**
 * Process-edge timers for the background workers: one-shots pace each
 * worker loop (`startWorkerLoop`); intervals keep fixed heartbeats such as
 * lease renewals, which are not polls.
 */
export type WorkerTimers = OneShotTimer & {
  readonly setInterval: (task: () => Promise<void>, ms: number) => unknown;
  readonly clearInterval: (handle: unknown) => void;
};
