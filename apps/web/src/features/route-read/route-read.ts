/**
 * The Server-Timing name the proxy gives a route read: the response to a
 * router's RSC GET that is not a prefetch. The browser observes it through
 * Resource Timing to learn when a refresh has finished arriving, without
 * wrapping the transport.
 */
export const routeReadTiming = 'route-read';

type ReadHeaders = { readonly get: (name: string) => string | null };

/** Whether a request is a route read: an RSC GET that is not a prefetch. */
export const isRouteRead = (method: string, headers: ReadHeaders): boolean =>
  method.toUpperCase() === 'GET' &&
  headers.get('rsc') === '1' &&
  headers.get('next-router-prefetch') !== '1';
