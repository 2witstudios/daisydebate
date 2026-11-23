'use client';

import { useEffect, useEffectEvent } from 'react';
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
