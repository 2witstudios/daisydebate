import type { Pace } from './waits';

/** The reason a deadline aborts with, as `AbortSignal.timeout` gives it. */
export const deadlineReason = (): DOMException =>
  new DOMException('The operation timed out.', 'TimeoutError');

export type Deadline = {
  /** Aborts `ms` after the deadline was set, or when any parent aborts. */
  readonly signal: AbortSignal;
  /** Ends the wait early; the signal stays as it is. */
  readonly clear: () => void;
};

/**
 * A bound on one operation, on injected time (R4.7): the replacement for
 * `AbortSignal.timeout` and for a host timer that rejects. The signal aborts
 * with a `TimeoutError` when `ms` pass, or with a parent's reason when a
 * parent aborts first. `clear` once the operation ends, so no wait is left.
 */
export function deadlineSignal(
  waits: Pace,
  ms: number,
  ...parents: readonly AbortSignal[]
): Deadline {
  const timeout = new AbortController();
  const cancel = new AbortController();
  const signal =
    parents.length === 0
      ? timeout.signal
      : AbortSignal.any([...parents, timeout.signal]);
  const stop = AbortSignal.any([cancel.signal, signal]);
  const dueMs = waits.nowMs() + Math.max(0, ms);
  void waits
    .waitUntilMs(dueMs, stop)
    .catch(() => undefined)
    .then(() => {
      // A wait that wakes early is no deadline: only the clock says it passed.
      if (!stop.aborted && waits.nowMs() >= dueMs)
        timeout.abort(deadlineReason());
    });
  return { signal, clear: () => cancel.abort() };
}

/**
 * Runs `work` under a deadline: rejects with a `TimeoutError` when `ms`
 * pass first. `work` receives the deadline's signal so it can stop too.
 */
export async function withDeadline<T>(
  waits: Pace,
  ms: number,
  work: (signal: AbortSignal) => Promise<T>,
  ...parents: readonly AbortSignal[]
): Promise<T> {
  const deadline = deadlineSignal(waits, ms, ...parents);
  const aborted = new Promise<never>((_, reject) => {
    const refuse = () => reject(deadline.signal.reason);
    if (deadline.signal.aborted) refuse();
    else deadline.signal.addEventListener('abort', refuse, { once: true });
  });
  aborted.catch(() => undefined);
  try {
    return await Promise.race([work(deadline.signal), aborted]);
  } finally {
    deadline.clear();
  }
}

/**
 * Runs `run` once `ms` have passed on injected time, unless the returned
 * cancel is called first: a one-shot callback (a debounce, a retry pause, a
 * silence timer) with no host timer behind it.
 */
export function afterMs(waits: Pace, ms: number, run: () => void): () => void {
  const cancel = new AbortController();
  const dueMs = waits.nowMs() + Math.max(0, ms);
  void waits
    .waitUntilMs(dueMs, cancel.signal)
    .catch(() => undefined)
    .then(() => {
      if (!cancel.signal.aborted && waits.nowMs() >= dueMs) run();
    });
  return () => cancel.abort();
}
