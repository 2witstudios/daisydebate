import type { WorkerTimers } from './worker-timers';
/** Manual interval registry keyed by period; tests fire ticks explicitly. */
export function manualTimers() {
  const tasks = new Map<number, () => Promise<void>>();
  const timers: WorkerTimers = {
    setInterval: (task, ms) => {
      tasks.set(ms, task);
      return ms;
    },
    clearInterval: (handle) => {
      tasks.delete(handle as number);
    },
  };
  return { tasks, timers };
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
