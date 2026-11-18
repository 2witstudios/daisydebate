import type { WorkerTimers } from '../../lib/worker-timers';
import { passOf } from '../../lib/idle-backoff';
import {
  HOUSEKEEPING_IDLE_MAX_MS,
  startWorkerLoop,
} from '../../lib/worker-loop';

/**
 * A durable mail queue's loop (beta mail intents, ADR 0075; notification
 * emails, ADR 0124): one batch per pass, never two at once in this process,
 * backing off while a pass sends nothing (ADR 0154).
 * Several web instances may run it together; the store's leases keep them
 * off each other's mail.
 */
export function startMailQueueWorker(input: {
  readonly run: (limit: number) => Promise<number>;
  readonly batch: number;
  readonly everyMs: number;
  readonly timers: WorkerTimers;
  readonly failed: (error: unknown) => void;
}) {
  return startWorkerLoop({
    run: () => input.run(input.batch).then(passOf),
    backoff: {
      busyMs: input.everyMs,
      idleMaxMs: Math.max(input.everyMs, HOUSEKEEPING_IDLE_MAX_MS),
    },
    timers: input.timers,
    failed: input.failed,
  });
}
