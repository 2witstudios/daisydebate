import type { Scheduler } from '../realtime/connection-store';
import type { RoundTime } from '../round-runtime/round-time';

/** Re-arm the same boundary on calibration, without replacing its media session. */
export function scheduleMediaDeadline(options: {
  readonly deadlineMs: number;
  readonly roundTime: RoundTime;
  readonly scheduler: Scheduler;
  readonly refresh: () => void;
}): () => void {
  let timer: unknown = null;
  let fired = false;
  const clear = () => {
    if (timer !== null) options.scheduler.clearTimeout(timer);
    timer = null;
  };
  // Fires once, so wait until even the clock's lower bound has passed: a read
  // sent before the true boundary would only see the old grant.
  const remainingMs = () =>
    options.deadlineMs - options.roundTime.lowerBoundMs();
  const arm = () => {
    clear();
    if (fired) return;
    timer = options.scheduler.setTimeout(
      () => {
        timer = null;
        if (remainingMs() > 0) {
          arm();
          return;
        }
        fired = true;
        options.refresh();
      },
      Math.max(0, remainingMs()),
    );
  };
  const unsubscribe = options.roundTime.subscribe(arm);
  arm();
  return () => {
    fired = true;
    clear();
    unsubscribe();
  };
}

/** What this mount means by "now" and "at this deadline": the sampled Round clock,
 * due only once its lower bound has passed. That holds a read back from the
 * boundary as far as the clock's evidence goes; a wrong server stamp can still
 * fire it early, and then the next view's read corrects the grant (ADR 0066). */
export function roundTimeMediaClock(options: {
  readonly roundTime: RoundTime;
  readonly scheduler: Scheduler;
}) {
  const { roundTime, scheduler } = options;
  return {
    now: () => roundTime.lowerBoundMs(),
    at: (deadlineMs: number, fire: () => void) =>
      scheduleMediaDeadline({
        deadlineMs,
        roundTime,
        scheduler,
        refresh: fire,
      }),
  };
}
