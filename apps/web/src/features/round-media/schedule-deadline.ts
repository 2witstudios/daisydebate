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
    options.deadlineMs +
    (options.roundTime.status().uncertaintyMs ?? 0) -
    options.roundTime.nowMs();
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
