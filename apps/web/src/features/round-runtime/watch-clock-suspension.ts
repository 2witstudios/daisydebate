import type { Scheduler } from '../realtime/connection-store';

const CHECK_EVERY_MS = 5000;
/** Well above timer throttling, which stretches a tick but not a whole sleep. */
const SUSPENDED_AFTER_MS = 30_000;

/**
 * `performance.now` may not advance through an OS sleep, so a monotonic clock
 * cannot notice one. The wall clock only signals that a sample is due here; it
 * never reaches any displayed time.
 */
export function watchClockSuspension(options: {
  readonly scheduler: Scheduler;
  readonly wallNowMs: () => number;
  readonly onResume: () => void;
}) {
  let last = options.wallNowMs();
  let timer: unknown = null;
  const check = () => {
    const now = options.wallNowMs();
    if (Math.abs(now - last) > SUSPENDED_AFTER_MS) options.onResume();
    last = now;
    timer = options.scheduler.setTimeout(check, CHECK_EVERY_MS);
  };
  timer = options.scheduler.setTimeout(check, CHECK_EVERY_MS);
  return () => options.scheduler.clearTimeout(timer);
}
