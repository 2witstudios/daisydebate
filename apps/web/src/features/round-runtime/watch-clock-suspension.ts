import type { Scheduler } from '../realtime/connection-store';

const CHECK_EVERY_MS = 5000;
/** How much further the wall clock must move than the monotonic clock did. */
const SUSPENDED_AFTER_MS = 30_000;

/**
 * `performance.now` may not advance through an OS sleep, so a monotonic clock
 * cannot notice one: the wall clock runs on while it stands still. A throttled
 * timer moves both alike, so it is not a sleep. The wall clock only signals that
 * a sample is due here; it never reaches any displayed time.
 */
export function watchClockSuspension(options: {
  readonly scheduler: Scheduler;
  readonly wallNowMs: () => number;
  readonly onResume: () => void;
}) {
  const { scheduler, wallNowMs } = options;
  let lastWall = wallNowMs();
  let lastMonotonic = scheduler.now();
  let timer: unknown = null;
  const check = () => {
    const wall = wallNowMs();
    const monotonic = scheduler.now();
    if (
      Math.abs(wall - lastWall - (monotonic - lastMonotonic)) >
      SUSPENDED_AFTER_MS
    )
      options.onResume();
    lastWall = wall;
    lastMonotonic = monotonic;
    timer = options.scheduler.setTimeout(check, CHECK_EVERY_MS);
  };
  timer = options.scheduler.setTimeout(check, CHECK_EVERY_MS);
  return () => options.scheduler.clearTimeout(timer);
}
