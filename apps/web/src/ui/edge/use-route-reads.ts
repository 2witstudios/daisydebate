'use client';

import { useEffect, useEffectEvent } from 'react';

/** A route read whose response has finished arriving. */
export type RouteRead = {
  readonly url: URL;
};

/**
 * The query Next's App Router puts on every RSC read it fetches
 * (`NEXT_RSC_UNION_QUERY` in next 16.4.6); a server action posts to the
 * page URL without it.
 */
const rscQuery = '_rsc';

type PageLocation = Pick<Location, 'href' | 'origin'>;

/** The route read a Resource Timing entry records, if it is one. */
export const routeReadOf = (
  entry: Pick<PerformanceResourceTiming, 'initiatorType' | 'name'>,
  page: PageLocation,
): RouteRead | null => {
  if (entry.initiatorType !== 'fetch') return null;
  const url = new URL(entry.name, page.href);
  if (url.origin !== page.origin) return null;
  return url.searchParams.has(rscQuery) ? { url } : null;
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
        const read = routeReadOf(
          entry as PerformanceResourceTiming,
          window.location,
        );
        if (read !== null) report(read);
      }
    });
    observer.observe({ type: 'resource' });
    return () => observer.disconnect();
  }, []);
}
