'use client';
import { useEffect, useState } from 'react';
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
  useEffect(() => {
    const tick = () => setNow(clock.nowMs());
    tick();
    const unsubscribe = clock.subscribe(tick);
    const timer = window.setInterval(tick, 1000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      unsubscribe();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [clock]);
  return now;
}
