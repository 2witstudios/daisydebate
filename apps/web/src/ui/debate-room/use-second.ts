'use client';
import { useDocumentShown } from '../edge/use-dom-events';
import { useResource } from '../edge/use-driver';
import { useTick } from '../edge/use-tick';
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
  const tick = () => setNow(clock.nowMs());
  // Following the clock reads it at once, then on each re-anchor.
  useResource(clock, (followed) => {
    setNow(followed.nowMs());
    return { dispose: followed.subscribe(() => setNow(followed.nowMs())) };
  });
  useTick(tick, 1000, clock);
  useDocumentShown(tick);
  return now;
}
