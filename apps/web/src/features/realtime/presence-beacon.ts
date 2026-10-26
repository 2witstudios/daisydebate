import type { ConnectionStore, Scheduler } from './connection-types';

/** ADR 0033 §1: idle after five minutes without input, or while hidden. */
export const IDLE_AFTER_MS = 300_000;

/**
 * Keeps a signed-in tab's realtime connection open so its presence lease
 * lives, and reports `idle` while the tab is hidden or has had no input for
 * `IDLE_AFTER_MS`, `active` otherwise. Input only stamps a time; one timer
 * checks it, so a burst of input costs no timer churn. Returns a stop that
 * closes the connection.
 */
export function startPresenceBeacon({
  connection,
  scheduler,
  isVisible,
  onVisibilityChange,
  onInput,
}: {
  readonly connection: Pick<
    ConnectionStore,
    'connect' | 'close' | 'reportActivity'
  >;
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
    timer = null;
    if (!isVisible()) return connection.reportActivity('idle');
    const quiet = scheduler.now() - lastInput;
    if (quiet >= IDLE_AFTER_MS) return connection.reportActivity('idle');
    connection.reportActivity('active');
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
  connection.connect();
  check();
  return () => {
    stopVisibility();
    stopInput();
    if (timer !== null) scheduler.clearTimeout(timer);
    connection.close();
  };
}
