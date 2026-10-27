import type { WorkerTimers } from '../../server/worker-timers';

/**
 * The mail intent worker's loop (ADR 0075): one batch per tick, never two at
 * once in this process. Several web instances may run it together; the
 * store's leases keep them off each other's intents.
 */
export function startMailIntentService(input: {
  readonly run: (limit: number) => Promise<number>;
  readonly batch: number;
  readonly everyMs: number;
  readonly timers: WorkerTimers;
  readonly failed: (error: unknown) => void;
}) {
  let running: Promise<void> | null = null;
  let stopped = false;
  const tick = (): Promise<void> => {
    if (stopped || running) return running ?? Promise.resolve();
    running = input
      .run(input.batch)
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
