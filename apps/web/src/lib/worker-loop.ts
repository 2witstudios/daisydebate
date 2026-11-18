import {
  nextWaitMs,
  validateIdleBackoff,
  type IdleBackoff,
  type LoopOutcome,
  type LoopPass,
} from './idle-backoff';
import type { OneShotTimer } from './worker-timers';

/** Idle caps by urgency: a live Round loop is also woken, housekeeping is not. */
export const LIVE_IDLE_MAX_MS = 10_000;
export const HOUSEKEEPING_IDLE_MAX_MS = 60_000;

/** Lossy "work may be waiting" signals for one worker; never authority. */
export type WorkWake = {
  readonly subscribe: (listener: () => void) => () => void;
};

/**
 * Every polling background worker's loop (ADR 0154). One pass at a time in
 * this process: it runs at once, then after a wait the idle back-off sets
 * from what each pass found. A wake runs a pass now, or once more straight
 * after the pass in flight, and resets the back-off; the back-off cap bounds
 * how late a lost wake can make work. A failed pass is reported and backs
 * off like an empty one. Other instances may run the same loop; each
 * caller's store keeps them off each other's work.
 */
export function startWorkerLoop(input: {
  readonly run: () => Promise<LoopPass>;
  readonly backoff: IdleBackoff;
  readonly timers: OneShotTimer;
  readonly failed: (error: unknown) => void;
  readonly wake?: WorkWake | undefined;
}) {
  const backoff = validateIdleBackoff(input.backoff);
  let stopped = false;
  let running: Promise<void> | null = null;
  let handle: unknown = null;
  let waitMs: number | null = null;
  let wokenDuringPass = false;
  const disarm = () => {
    if (handle === null) return;
    input.timers.clearTimeout(handle);
    handle = null;
  };
  const arm = (ms: number) => {
    disarm();
    handle = input.timers.setTimeout(() => {
      handle = null;
      return pass();
    }, ms);
  };
  const pass = (): Promise<void> => {
    if (stopped) return Promise.resolve();
    if (running) return running;
    disarm();
    running = input
      .run()
      .then(
        (found): LoopOutcome => found,
        (error: unknown): LoopOutcome => {
          input.failed(error);
          return 'failed';
        },
      )
      .then((outcome) => {
        running = null;
        if (stopped) return;
        if (wokenDuringPass) {
          wokenDuringPass = false;
          waitMs = null;
          void pass();
          return;
        }
        waitMs = nextWaitMs(backoff, waitMs, outcome);
        arm(waitMs);
      });
    return running;
  };
  const wake = () => {
    if (stopped) return;
    if (running) {
      wokenDuringPass = true;
      return;
    }
    waitMs = null;
    void pass();
  };
  const unsubscribe = input.wake?.subscribe(wake);
  const started = pass();
  return {
    started,
    /** Work may be waiting: pass now and reset the back-off. */
    wake,
    async stop() {
      stopped = true;
      unsubscribe?.();
      disarm();
      await running;
    },
  };
}
