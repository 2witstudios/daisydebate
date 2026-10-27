import {
  startSingleFlightWorker,
  type WorkerTimers,
} from '../../lib/worker-timers';

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
  return startSingleFlightWorker({
    run: () => input.run(input.batch),
    everyMs: input.everyMs,
    timers: input.timers,
    failed: input.failed,
  });
}
