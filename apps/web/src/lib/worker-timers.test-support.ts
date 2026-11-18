import type { WorkerTimers } from './worker-timers';
/**
 * Manual timer registry keyed by period; tests fire ticks explicitly. A
 * worker loop's next pass is a one-shot under its wait, and firing it awaits
 * the pass; `waits` lists every one-shot armed, in order.
 */
export function manualTimers() {
  const tasks = new Map<number, () => Promise<void>>();
  const waits: number[] = [];
  const shots = new Map<object, number>();
  const timers: WorkerTimers = {
    setInterval: (task, ms) => {
      tasks.set(ms, task);
      return ms;
    },
    clearInterval: (handle) => {
      tasks.delete(handle as number);
    },
    setTimeout: (run, ms) => {
      const handle = {};
      waits.push(ms);
      shots.set(handle, ms);
      tasks.set(ms, async () => {
        if (!shots.has(handle)) return;
        shots.delete(handle);
        tasks.delete(ms);
        await run();
      });
      return handle;
    },
    clearTimeout: (handle) => {
      const ms = shots.get(handle as object);
      shots.delete(handle as object);
      if (ms !== undefined) tasks.delete(ms);
    },
  };
  /**
   * Fires the armed worker-loop pass, whatever its wait; a pass still
   * running arms its successor when it ends, so this waits for that first.
   */
  const nextPass = async () => {
    for (let turn = 0; turn < 50 && shots.size === 0; turn += 1)
      await new Promise((settle) => setTimeout(settle, 0));
    const [ms] = [...shots.values()];
    if (ms === undefined) throw new Error('No worker pass armed');
    await tasks.get(ms)!();
  };
  return { tasks, timers, waits, nextPass };
}

/** Records each worker failure as [error, stage]. */
export function failureLog() {
  const failures: unknown[] = [];
  return {
    failures,
    failed: (error: unknown, stage: string) => {
      failures.push([error, stage]);
    },
  };
}

/** Timers that never fire: a worker runs only its start-up pass. */
export const inertTimers: WorkerTimers = {
  setInterval: () => 1,
  clearInterval: () => {},
  setTimeout: () => 1,
  clearTimeout: () => {},
};

/** The process's own timers, for integration proofs that run in real time. */
export const realWorkerTimers: WorkerTimers = {
  setInterval: (task, ms) => setInterval(() => void task(), ms),
  clearInterval: (handle) =>
    clearInterval(handle as ReturnType<typeof setInterval>),
  setTimeout: (run, ms) => setTimeout(() => void run(), ms),
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Interval-only test timers, with each one-shot registered as an interval
 * under its wait: a worker loop's next pass is then captured and fired the
 * same way a test fires a tick.
 */
export const withOneShots = (intervals: {
  readonly setInterval: WorkerTimers['setInterval'];
  readonly clearInterval: WorkerTimers['clearInterval'];
}): WorkerTimers => ({
  ...intervals,
  setTimeout: (run, ms) =>
    intervals.setInterval(async () => void (await run()), ms),
  clearTimeout: intervals.clearInterval,
});
