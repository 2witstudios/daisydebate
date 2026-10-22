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
