import type { Waits } from '@daisy/clock';
import type { Worker } from './poll';

/** How a bounded stop ended: every worker stopped, or the bound passed first. */
export type Drain = 'drained' | 'overdue';

/**
 * Stops every worker at once and waits for them, at most `deadlineMs`: a
 * process shutting down must exit within its grace even when work in flight
 * is stuck on a store that never answers. On `overdue` the caller exits; the
 * work still running dies with the process.
 */
export async function stopAll(input: {
  readonly waits: Waits;
  readonly workers: readonly Worker[];
  readonly deadlineMs: number;
}): Promise<Drain> {
  const bound = new AbortController();
  const stopped = Promise.all(
    input.workers.map((worker) => worker.stop()),
  ).then(() => 'drained' as const);
  const overdue = input.waits
    .sleep(input.deadlineMs, bound.signal)
    .then(() => 'overdue' as const);
  try {
    return await Promise.race([stopped, overdue]);
  } finally {
    bound.abort();
  }
}
