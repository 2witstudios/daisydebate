/**
 * Reads the browser's own session from the auth handler, uncached and
 * bounded at 15 s on top of the caller's own cancellation.
 */
export const readBrowserSession = (signal: AbortSignal): Promise<Response> =>
  window.fetch('/api/auth/get-session', {
    cache: 'no-store',
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
  });
