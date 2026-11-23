import type { Waits } from '@daisy/clock';

/**
 * The host's time, the one server module that touches its timers (R4.7;
 * `daisy-time/host-time` refuses them everywhere else). A process entry
 * passes it to the work it starts. A pending wait never holds the process
 * open, and an aborted wait clears its timer at once.
 */
const waitUntilMs = (dueMs: number, signal?: AbortSignal): Promise<void> =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(
      done,
      Math.max(0, dueMs - performance.now()),
    ).unref();
    signal?.addEventListener('abort', done, { once: true });
  });

export const hostWaits: Waits = {
  nowMs: () => performance.now(),
  sleep: (ms, signal) =>
    waitUntilMs(performance.now() + Math.max(0, ms), signal),
  waitUntilMs,
};
