'use client';

import { useEffect, useEffectEvent, useState } from 'react';
import { browserScheduler } from './browser-time';

/**
 * Runs `run` every `intervalMs` while it is not null. A tick reads the
 * current callback without restarting the cadence; `key` restarts it.
 */
export function useTick(
  run: () => void,
  intervalMs: number | null,
  key?: unknown,
) {
  const tick = useEffectEvent(run);
  useEffect(() => {
    if (intervalMs !== null)
      return browserScheduler.every(() => tick(), intervalMs);
  }, [intervalMs, key]);
}

/**
 * Runs `run` once, `waitMs` after it was armed, unless the wait is
 * disarmed (null) or re-armed first: a change of `waitMs` or `key` starts
 * the wait again, and leaving the page cancels it.
 */
export function useDelay(
  run: () => void,
  waitMs: number | null,
  key?: unknown,
) {
  const fire = useEffectEvent(run);
  useEffect(() => {
    if (waitMs !== null) return browserScheduler.after(() => fire(), waitMs);
  }, [waitMs, key]);
}

/** One wait for the next paint, armed from the owner's own events. */
export type FrameWait = {
  /** Runs `run` before the next paint, replacing any frame already armed. */
  readonly arm: (run: () => void) => void;
  readonly cancel: () => void;
};

function createFrameWait(): FrameWait {
  let cancelArmed: (() => void) | null = null;
  const cancel = () => {
    cancelArmed?.();
    cancelArmed = null;
  };
  return {
    arm(run) {
      cancel();
      cancelArmed = browserScheduler.frame(() => {
        cancelArmed = null;
        run();
      });
    },
    cancel,
  };
}

/** A frame wait the owner arms and cancels; leaving the page cancels it. */
export function useFrame(): FrameWait {
  const [frame] = useState(createFrameWait);
  useEffect(() => frame.cancel, [frame]);
  return frame;
}
