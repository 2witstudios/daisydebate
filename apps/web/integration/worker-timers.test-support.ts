import type { WorkerTimers } from '../src/lib/worker-timers';

/** The process's own timers, for integration proofs that run in real time. */
export const realWorkerTimers: WorkerTimers = {
  now: () => performance.now(),
  setInterval: (task, ms) => setInterval(() => void task(), ms),
  clearInterval: (handle) =>
    clearInterval(handle as ReturnType<typeof setInterval>),
  setTimeout: (run, ms) => setTimeout(() => void run(), ms),
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
};
