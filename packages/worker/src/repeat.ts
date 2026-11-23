import type { Waits } from '@daisy/clock';
import { report, type FailureSink } from './failure';
import type { Worker } from './poll';

export type RepeatWorker = Worker & {
  /** The start-up run, when `runOnStart` is set. */
  readonly initial: Promise<void> | undefined;
};

/**
 * Work on a fixed cadence, not a poll: a sweep, a gauge, a heartbeat. Runs
 * fall every `everyMs` from the start; a run due while the last is still
 * going is skipped, never queued, so runs never overlap and a slow run never
 * makes a burst. Every instance may run the same schedule when each run's
 * work is race-free (`SKIP LOCKED`, one atomic operation, an idempotent
 * delivery).
 */
export function repeatEvery(input: {
  readonly waits: Waits;
  readonly everyMs: number;
  /** One run; `signal` aborts when the worker stops, so it can end between its own steps. */
  readonly run: (signal: AbortSignal) => Promise<unknown>;
  readonly failed: FailureSink;
  /** Also run once now: a process restarted more often than the cadence still does the work. */
  readonly runOnStart?: boolean;
  /**
   * Resolves true once the start-up run's dependencies answer. False or a
   * rejection skips the start-up run; the cadence runs regardless. A run due
   * during this wait is skipped, as if the start-up run were going.
   */
  readonly ready?: (signal: AbortSignal) => Promise<boolean>;
}): RepeatWorker {
  if (!Number.isSafeInteger(input.everyMs) || input.everyMs < 1)
    throw new Error('Invalid repeat cadence');
  const { waits } = input;
  const stopping = new AbortController();
  let current: Promise<void> | null = null;
  const runOnce = async () => {
    try {
      await input.run(stopping.signal);
    } catch (error) {
      report(input.failed, error);
    }
  };
  /** Starts `work` unless a run is going; resolves when it ends. */
  const claim = (work: () => Promise<void>): Promise<void> => {
    if (current !== null || stopping.signal.aborted) return Promise.resolve();
    const going = work().finally(() => {
      current = null;
    });
    current = going;
    return going;
  };
  const initial = input.runOnStart
    ? claim(async () => {
        if (input.ready === undefined) return runOnce();
        const ready = await input.ready(stopping.signal).catch(() => false);
        if (ready && !stopping.signal.aborted) await runOnce();
      })
    : undefined;
  const cadence = async () => {
    let dueMs = waits.nowMs() + input.everyMs;
    while (!stopping.signal.aborted) {
      await waits.waitUntilMs(dueMs, stopping.signal);
      if (stopping.signal.aborted) return;
      void claim(runOnce);
      // A process that slept through several runs makes up none of them.
      dueMs = Math.max(dueMs, waits.nowMs()) + input.everyMs;
    }
  };
  const ticking = cadence();
  return {
    initial,
    async stop() {
      stopping.abort();
      await ticking;
      await current;
    },
  };
}
