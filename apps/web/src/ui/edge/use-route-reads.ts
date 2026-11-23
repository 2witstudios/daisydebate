'use client';

import { useEffect, useEffectEvent } from 'react';
import { routeReadTiming } from '../../features/route-read/route-read';

/** A route read whose response has finished arriving. */
export type RouteRead = {
  readonly url: URL;
  /** When the request started, on the page's monotonic clock. */
  readonly startedMs: number;
};

const routeReadOf = (entry: PerformanceEntry): RouteRead | null => {
  const timing = entry as PerformanceResourceTiming;
  if (timing.initiatorType !== 'fetch') return null;
  if (!timing.serverTiming.some(({ name }) => name === routeReadTiming))
    return null;
  const url = new URL(timing.name, window.location.href);
  if (url.origin !== window.location.origin) return null;
  return { url, startedMs: timing.startTime };
};

/**
 * Reports each same-origin route read once its response has finished, as
 * Resource Timing records it: the transport is observed, never wrapped.
 * The handler is read at its latest.
 */
export function useRouteReads(onRead: (read: RouteRead) => void): void {
  const report = useEffectEvent(onRead);
  useEffect(() => {
    if (typeof PerformanceObserver === 'undefined') return;
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const read = routeReadOf(entry);
        if (read !== null) report(read);
      }
    });
    observer.observe({ type: 'resource' });
    return () => observer.disconnect();
  }, []);
}
