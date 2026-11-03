import type { WorkerTimers } from '../lib/worker-timers';

const HOUR_MS = 3_600_000;

/**
 * A recurring run inside the existing server process (no new service): the
 * retention sweep and each scheduled worker. Every instance runs it; that is
 * safe because each run's work is race-free (`SKIP LOCKED`, one atomic Lua
 * op, or an idempotent delivery). A tick that arrives while this process is
 * still running is skipped.
 */
export function startRunSchedule({
  work,
  timers,
  intervalMs = HOUR_MS,
  runOnStart = false,
  waitUntilReady,
}: {
  readonly work: {
    readonly run: () => Promise<unknown>;
    /** Ends a run early, between its own steps. */
    readonly stop?: () => void;
  };
  readonly timers: WorkerTimers;
  readonly intervalMs?: number;
  /** Also run once now: processes restarted more often than the interval still do the work. */
  readonly runOnStart?: boolean;
  /**
   * Resolves true once the start-up run's dependencies are reachable
   * (ISSUE-146): a freshly started Fly machine's Redis connection is not
   * necessarily ready the instant this process starts listening, so
   * `runOnStart`'s one run waits here instead of logging a spurious
   * failure on every cold boot. Resolving false or
   * rejecting means the dependencies never became reachable: the start-up
   * run is skipped and the next tick runs instead. Omitted, the
   * start-up run fires synchronously. Ignored when `runOnStart` is false;
   * the schedule never waits on it. Reserves `current` for the whole wait, so a timer
   * tick that arrives during it is skipped rather than racing the start-up
   * run.
   */
  readonly waitUntilReady?: () => Promise<boolean>;
}) {
  let stopped = false;
  let current: Promise<unknown> | undefined;
  const tick = async () => {
    if (stopped || current) return;
    const run = work.run().finally(() => {
      current = undefined;
    });
    current = run;
    await run;
  };
  const handle = timers.setInterval(tick, intervalMs);
  let initial: Promise<unknown> | undefined;
  if (runOnStart) {
    if (waitUntilReady) {
      const started = waitUntilReady()
        .catch(() => false)
        .then((ready) => {
          current = undefined;
          return ready ? tick() : undefined;
        });
      current = started;
      initial = started;
    } else {
      initial = tick();
    }
  }
  return {
    /** The start-up run, when `runOnStart` is set. */
    initial,
    /** Stops scheduling and resolves once any run in progress has ended. */
    stop: async () => {
      stopped = true;
      timers.clearInterval(handle);
      work.stop?.();
      await current;
    },
  };
}
