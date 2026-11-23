import type { Waits } from '@daisy/clock';

/**
 * The host's time, the one server module that touches its timers (R4.7;
 * `daisy-time/host-time` refuses them everywhere else). A process entry
 * passes it to the work it starts. A pending wait keeps the process alive,
 * as a worker process's schedule must; stopping a worker aborts its waits,
 * and an aborted wait clears its timer at once, so a stopped process exits.
 * A host timer may fire a little before its delay; the wait re-arms until
 * the clock has reached `dueMs`, so a wait never ends early.
 */
const MAX_TIMER_MS = 2 ** 31 - 1;

const waitUntilMs = (dueMs: number, signal?: AbortSignal): Promise<void> =>
  new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', done);
      resolve();
    };
    const arm = () => {
      const leftMs = dueMs - performance.now();
      if (leftMs <= 0) return done();
      // A host timer clamps a delay past 2^31 - 1 ms (or Infinity) to 1 ms, so a
      // long wait is armed in steps, never as a spin.
      timer = setTimeout(arm, Math.min(Math.ceil(leftMs), MAX_TIMER_MS));
    };
    signal?.addEventListener('abort', done, { once: true });
    arm();
  });

export const hostWaits: Waits = {
  nowMs: () => performance.now(),
  sleep: (ms, signal) =>
    waitUntilMs(performance.now() + Math.max(0, ms), signal),
  waitUntilMs,
};
