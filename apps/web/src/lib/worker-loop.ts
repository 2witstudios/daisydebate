import {
  nextWaitMs,
  validateIdleBackoff,
  type IdleBackoff,
  type LoopOutcome,
  type LoopPass,
} from './idle-backoff';
import type { LoopTimers } from './worker-timers';

/**
 * Idle caps by urgency. Live-Round loops are woken where a command creates
 * their work; Room maintenance and housekeeping rely on the cap alone.
 */
export const LIVE_IDLE_MAX_MS = 10_000;
export const HOUSEKEEPING_IDLE_MAX_MS = 60_000;

/** Lossy "work may be waiting" signals for one worker; never authority. */
export type WorkWake = {
  readonly subscribe: (listener: () => void) => () => void;
};

/**
 * Every polling background worker's loop (ADR 0154). One pass at a time in
 * this process: it runs at once, then after a wait the idle back-off sets
 * from what each pass found. A wake resets the back-off and brings the next
 * pass forward, but never sooner than `busyMs` after the last pass started:
 * wakes in between coalesce into that one pass, so the busy interval stays a
 * rate ceiling however often work is created. The back-off cap bounds how
 * late a lost wake can make work. A failed pass is reported and backs off
 * like an empty one. Other instances may run the same loop; each caller's
 * store keeps them off each other's work.
 */
export function startWorkerLoop(input: {
  readonly run: () => Promise<LoopPass>;
  readonly backoff: IdleBackoff;
  readonly timers: LoopTimers;
  readonly failed: (error: unknown) => void;
  readonly wake?: WorkWake | undefined;
}) {
  const backoff = validateIdleBackoff(input.backoff);
  let stopped = false;
  let running: Promise<void> | null = null;
  let handle: unknown = null;
  let waitMs: number | null = null;
  let wokenDuringPass = false;
  let lastStartedAt: number | null = null;
  /** How long until a pass may start without exceeding the busy rate. */
  const untilPaced = () =>
    lastStartedAt === null
      ? 0
      : Math.max(0, lastStartedAt + backoff.busyMs - input.timers.now());
  /** Run a woken pass now if the busy rate allows it, else as soon as it does. */
  const passWhenPaced = () => {
    const delay = untilPaced();
    if (delay === 0) void pass();
    else arm(delay);
  };
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
    lastStartedAt = input.timers.now();
    running = input
      .run()
      .then(
        (found): LoopOutcome => found,
        (error: unknown): LoopOutcome => {
          // A reporter that throws must never stop the loop for good.
          try {
            input.failed(error);
          } catch {
            /* The next pass reports again. */
          }
          return 'failed';
        },
      )
      .then((outcome) => {
        running = null;
        if (stopped) return;
        if (wokenDuringPass) {
          wokenDuringPass = false;
          waitMs = null;
          passWhenPaced();
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
    passWhenPaced();
  };
  const unsubscribe = input.wake?.subscribe(wake);
  const started = pass();
  return {
    started,
    /** Work may be waiting: reset the back-off and pass as soon as the busy rate allows. */
    wake,
    async stop() {
      stopped = true;
      unsubscribe?.();
      disarm();
      await running;
    },
  };
}
