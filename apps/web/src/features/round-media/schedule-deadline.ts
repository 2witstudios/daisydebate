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
  const arm = () => {
    clear();
    if (fired) return;
    timer = options.scheduler.setTimeout(
      () => {
        timer = null;
        if (options.roundTime.nowMs() < options.deadlineMs) {
          arm();
          return;
        }
        fired = true;
        options.refresh();
      },
      Math.max(0, options.deadlineMs - options.roundTime.nowMs()),
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
