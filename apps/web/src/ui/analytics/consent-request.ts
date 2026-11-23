import type { BrowserTransport } from '../edge/browser-request';

/** Posts a consent choice to the route the native form posts to. */
export const postConsent = (
  send: BrowserTransport,
  body: string | URLSearchParams,
): Promise<Response> =>
  send('/api/analytics/consent', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
