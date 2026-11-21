'use client';

import { useEffect, useEffectEvent } from 'react';
import { scheduleTick } from './browser-time';

/** A committed tick reads the current callback without restarting the cadence. */
export function useTick(run: () => void, intervalMs: number | null) {
  const tick = useEffectEvent(run);
  useEffect(() => {
    if (intervalMs !== null) return scheduleTick(() => tick(), intervalMs);
  }, [intervalMs]);
}
