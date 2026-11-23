import type { VirtualClock } from '@daisy/clock/testing';
import type { BrowserScheduler } from '../edge/browser-time';

/**
 * Test support: the browser's timer ports on a clock the test owns (ADR
 * 0164). `scheduler` is the `BrowserScheduler` a driver takes; `windowTimers`
 * are the window functions a mounted test realm installs, so the edge's
 * `browserScheduler` waits on the same virtual time.
 */
export function virtualBrowserTime(clock: VirtualClock) {
  let next = 1;
  const cancels = new Map<number, () => void>();
  const after = (run: () => void, ms: number) => {
    const waiting = new AbortController();
    void clock.sleep(ms, waiting.signal).then(() => {
      if (!waiting.signal.aborted) run();
    });
    return () => waiting.abort();
  };
  const every = (run: () => void, ms: number) => {
    const waiting = new AbortController();
    const again = (): Promise<void> =>
      clock.sleep(ms, waiting.signal).then(() => {
        if (waiting.signal.aborted) return;
        run();
        return again();
      });
    void again();
    return () => waiting.abort();
  };
  const scheduler: BrowserScheduler = {
    after,
    every,
    frame: (run) => after(run, 0),
  };
  const hold = (cancel: () => void) => {
    const id = next++;
    cancels.set(id, cancel);
    return id;
  };
  const clear = (id: unknown) => {
    cancels.get(id as number)?.();
    cancels.delete(id as number);
  };
  return {
    scheduler,
    windowTimers: {
      setTimeout: (run: () => void, ms = 0) => hold(after(run, ms)),
      clearTimeout: clear,
      setInterval: (run: () => void, ms = 0) => hold(every(run, ms)),
      clearInterval: clear,
    },
  };
}
