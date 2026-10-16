export type RetryVisibility = {
  hidden: boolean;
  readonly addEventListener: (
    type: 'visibilitychange',
    listener: () => void,
  ) => void;
  readonly removeEventListener: (
    type: 'visibilitychange',
    listener: () => void,
  ) => void;
};

/** Matches the room page's refresh cadence, so recovery adds no load. */
export const AUTO_RETRY_DELAY_MS = 5000;

/**
 * Schedules one retry of a failed render while the page is visible. A
 * failed retry hands the boundary a new error, which schedules the next
 * one, so a short outage recovers without the viewer pressing anything and
 * a long one costs no more than the page's own polling.
 */
export function startAutoRetry({
  visibility,
  after,
  retry,
}: {
  readonly visibility: RetryVisibility;
  readonly after: (run: () => void, milliseconds: number) => () => void;
  readonly retry: () => void;
}): () => void {
  let stopped = false;
  let cancel: (() => void) | undefined;
  const fire = () => {
    if (stopped) return;
    stop();
    retry();
  };
  const schedule = () => {
    if (stopped) return;
    if (visibility.hidden) {
      cancel?.();
      cancel = undefined;
    } else if (cancel === undefined) {
      cancel = after(fire, AUTO_RETRY_DELAY_MS);
    }
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancel?.();
    cancel = undefined;
    visibility.removeEventListener('visibilitychange', schedule);
  };
  visibility.addEventListener('visibilitychange', schedule);
  schedule();
  return stop;
}
