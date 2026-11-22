'use client';
import { useBrowserEffect } from '../edge/browser-sync';
import { scheduleTick } from '../edge/browser-time';
import { useState } from 'react';
import type { RoundTime } from '../../features/round-runtime/round-time';

/**
 * The server's clock at one instant, read once a second: the clock edge of a
 * live view. It starts from the server's render instant as the hydration seed
 * only, then advances from the shared round clock the room's lifetime owner
 * keeps calibrated; the browser's wall clock never enters. Re-ticks on
 * visibility return; a fresh authorized sample re-anchors the shared seam.
 */
export function useSecond(renderedAtMs: number, clock: RoundTime): number {
  const [now, setNow] = useState(renderedAtMs);
  useBrowserEffect(() => {
    const tick = () => setNow(clock.nowMs());
    tick();
    const unsubscribe = clock.subscribe(tick);
    const stopTimer = scheduleTick(tick, 1000, window);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      unsubscribe();
      stopTimer();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [clock]);
  return now;
}
