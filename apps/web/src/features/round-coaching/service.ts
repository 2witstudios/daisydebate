import { isAppError } from '@daisy/errors';
import type { WorkerTimers } from '../round-bots/worker-timers';

/**
 * The coaching worker (ADR 0071): each scan lists Rounds that need coaching
 * and starts one coaching call per Round, up to `parallel` at once. A call's
 * lease covers it whole, so nothing renews; a lapsed lease is simply claimed
 * again on a later scan while the Round has calls left.
 */
export function startRoundCoachingService(input: {
  readonly scan: (limit: number) => Promise<readonly string[]>;
  readonly coach: (roundId: string, signal: AbortSignal) => Promise<unknown>;
  readonly limits: {
    readonly parallel: number;
    readonly scanBatch: number;
    readonly scanMs: number;
  };
  readonly timers: WorkerTimers;
  /** `stage` names the work that failed: coach or scan. */
  readonly failed: (error: unknown, stage: string) => void;
}) {
  const running = new Map<string, Promise<void>>();
  const abort = new AbortController();
  let scanning: Promise<void> | null = null;
  const start = (roundId: string) => {
    const work = input
      .coach(roundId, abort.signal)
      .then(
        () => undefined,
        (error: unknown) => {
          // A full provider or a stop is not a fault: the Round waits for a later scan.
          if (isAppError(error) && error.code === 'CONFLICT') return;
          input.failed(error, 'coach');
        },
      )
      .finally(() => running.delete(roundId));
    running.set(roundId, work);
  };
  const scan = (): Promise<void> => {
    if (abort.signal.aborted || scanning) return scanning ?? Promise.resolve();
    // Cleared in a later turn: a scan that ends before its first await
    // would otherwise clear the marker before it is set.
    scanning = (async () => {
      try {
        if (running.size >= input.limits.parallel) return;
        for (const roundId of await input.scan(input.limits.scanBatch)) {
          if (abort.signal.aborted || running.size >= input.limits.parallel)
            break;
          if (!running.has(roundId)) start(roundId);
        }
      } catch (error) {
        input.failed(error, 'scan');
      }
    })().finally(() => {
      scanning = null;
    });
    return scanning;
  };
  const discovery = input.timers.setInterval(scan, input.limits.scanMs);
  const started = scan();
  return {
    started,
    async stop() {
      abort.abort();
      input.timers.clearInterval(discovery);
      await Promise.allSettled([scanning, ...running.values()]);
    },
  };
}
