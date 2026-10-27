import type { PresenceActivity } from '@daisy/protocol';
import type { Scheduler } from './connection-types';

/** ADR 0033 §1: idle after five minutes without input, or while hidden. */
export const IDLE_AFTER_MS = 300_000;

/**
 * A tab's one activity source (ADR 0072): reports `idle` while the tab is
 * hidden or has had no input for `IDLE_AFTER_MS`, `active` otherwise. Input
 * only stamps a time; one timer checks it, so a burst of input costs no
 * timer churn. Returns a stop that releases every listener.
 */
export function startPresenceBeacon({
  report,
  scheduler,
  isVisible,
  onVisibilityChange,
  onInput,
}: {
  readonly report: (activity: PresenceActivity) => void;
  readonly scheduler: Scheduler;
  readonly isVisible: () => boolean;
  readonly onVisibilityChange: (
    listener: (visible: boolean) => void,
  ) => () => void;
  readonly onInput: (listener: () => void) => () => void;
}): () => void {
  let lastInput = scheduler.now();
  let timer: unknown = null;
  const arm = (ms: number) => {
    if (timer !== null) scheduler.clearTimeout(timer);
    timer = scheduler.setTimeout(check, ms);
  };
  function check() {
    // A listener may run this while the timer is still pending: clear it so
    // only one check is ever scheduled.
    if (timer !== null) scheduler.clearTimeout(timer);
    timer = null;
    if (!isVisible()) return report('idle');
    const quiet = scheduler.now() - lastInput;
    if (quiet >= IDLE_AFTER_MS) return report('idle');
    report('active');
    arm(IDLE_AFTER_MS - quiet);
  }
  const stopVisibility = onVisibilityChange((visible) => {
    if (visible) lastInput = scheduler.now();
    check();
  });
  const stopInput = onInput(() => {
    lastInput = scheduler.now();
    if (timer === null && isVisible()) check();
  });
  check();
  return () => {
    stopVisibility();
    stopInput();
    if (timer !== null) scheduler.clearTimeout(timer);
  };
}
