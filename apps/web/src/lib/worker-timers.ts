/** Process-edge timers for the background worker loops. */
export type WorkerTimers = {
  readonly setInterval: (task: () => Promise<void>, ms: number) => unknown;
  readonly clearInterval: (handle: unknown) => void;
};

/** Process-edge one-shot timers, for deadlines a worker cancels once met. */
export type OneShotTimer = {
  readonly setTimeout: (run: () => void, ms: number) => unknown;
  readonly clearTimeout: (handle: unknown) => void;
};

/**
 * An interval loop that never overlaps itself in this process: it runs at
 * once, then once per tick while no run is in flight; a failed run is
 * reported and retried on the next tick, and stop waits for the run in
 * flight. Other instances may run the same loop; each caller's store keeps
 * them off each other's work.
 */
export function startSingleFlightWorker(input: {
  readonly run: () => Promise<unknown>;
  readonly everyMs: number;
  readonly timers: WorkerTimers;
  readonly failed: (error: unknown) => void;
}) {
  let running: Promise<void> | null = null;
  let stopped = false;
  const tick = (): Promise<void> => {
    if (stopped || running) return running ?? Promise.resolve();
    running = input
      .run()
      .then(
        () => undefined,
        (error: unknown) => input.failed(error),
      )
      .finally(() => {
        running = null;
      });
    return running;
  };
  const handle = input.timers.setInterval(tick, input.everyMs);
  const started = tick();
  return {
    started,
    async stop() {
      stopped = true;
      input.timers.clearInterval(handle);
      await running;
    },
  };
}
