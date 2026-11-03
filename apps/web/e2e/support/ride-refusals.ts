import type { BrowserContext } from '@playwright/test';

const ATTEMPTS = 5;

/**
 * A test's own API calls ask again when the server says asking can clear it, as
 * any client should. Only a temporary refusal carries Retry-After: the work
 * never ran, so resending it is safe (ADR 0088). A refusal that outlasts the
 * attempts is still answered, and the test sees it. Pages and their routes are
 * untouched, so a page's own recovery from a refusal is still what is proved.
 */
export function rideRefusals(context: BrowserContext) {
  const { request } = context;
  const fetch = request.fetch.bind(request);
  request.fetch = async (...input) => {
    for (let attempt = 1; ; attempt++) {
      const response = await fetch(...input);
      const retryAfter = response.headers()['retry-after'];
      if (response.status() !== 503 || !retryAfter || attempt === ATTEMPTS)
        return response;
      await new Promise((done) => setTimeout(done, Number(retryAfter) * 1_000));
    }
  };
}
