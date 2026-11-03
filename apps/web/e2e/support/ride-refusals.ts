import type { APIResponse, BrowserContext } from '@playwright/test';

const ATTEMPTS = 5;
const ridden = new WeakSet<APIResponse>();

/** This answer came after a refusal: it is not from when the call was made. */
export const wasRidden = (response: APIResponse) => ridden.has(response);

/** Auth stamps Retry-After on any 503, and its confirm redeems a one-time token. */
const isAuth = (input: Parameters<BrowserContext['request']['fetch']>[0]) => {
  const url = typeof input === 'string' ? input : input.url();
  return /^\/(api\/)?auth(\/|$)/.test(new URL(url, 'http://x').pathname);
};

/**
 * A test's own API calls ask again when the server says asking can clear it, as
 * any client should. Outside auth, only a temporary refusal carries Retry-After:
 * the work never ran, so resending it is safe (ADR 0088). A refusal that outlasts
 * the attempts is still answered, and the test sees it. Pages and their routes
 * are untouched, so a page's own recovery from a refusal is still what is proved.
 * A bar timed against an answer must check `wasRidden`.
 */
export function rideRefusals(context: Pick<BrowserContext, 'request'>) {
  const { request } = context;
  const fetch = request.fetch.bind(request);
  request.fetch = async (...input) => {
    if (isAuth(input[0])) return fetch(...input);
    for (let attempt = 1; ; attempt++) {
      const response = await fetch(...input);
      const retryAfter = response.headers()['retry-after'];
      if (attempt > 1) ridden.add(response);
      if (response.status() !== 503 || !retryAfter || attempt === ATTEMPTS)
        return response;
      await new Promise((done) => setTimeout(done, Number(retryAfter) * 1_000));
    }
  };
}
