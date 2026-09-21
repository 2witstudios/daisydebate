import { createAppError } from '@daisy/errors';
import { handleOperation } from '../../server/http';

type Handler = (request: Request) => Promise<Response>;

/**
 * Copies a Better Auth response into a fresh mutable one without consuming
 * or re-serializing the body; every Set-Cookie header survives verbatim.
 * Adds `Retry-After` (standard) beside Better Auth's `X-Retry-After`.
 */
export function preserve(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const cookie of response.headers.getSetCookie())
    if (!headers.getSetCookie().includes(cookie))
      headers.append('set-cookie', cookie);
  const retry = headers.get('x-retry-after');
  if (retry && !headers.has('retry-after')) headers.set('retry-after', retry);
  if (response.status === 503 && !headers.has('retry-after'))
    headers.set('retry-after', '5');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

/** A 503 mapped from a thrown limiter/infrastructure error advertises a retry. */
const withRetryAfter = (response: Response) =>
  response.status === 503 && !response.headers.has('retry-after')
    ? preserve(response)
    : response;

/**
 * Mounts Better Auth behind the shared operation wrapper: correlation and
 * no-store headers, structured completion logging that never includes the
 * URL, query or credentials, and safe public errors for thrown failures
 * (a limiter outage surfaces as a 503, never as an allowed request).
 */
export function createAuthRouteHandlers(
  auth: () => { handler: Handler; config: { PUBLIC_APP_URL: string } },
) {
  const handle = async (request: Request) =>
    withRetryAfter(
      await handleOperation(request, 'auth.request', async () => {
        const server = auth();
        // Better Auth only enforces origin on cookie-bearing requests; every
        // state-changing auth call must additionally come from our own origin.
        if (
          request.method !== 'GET' &&
          request.method !== 'HEAD' &&
          request.headers.get('origin') !==
            new URL(server.config.PUBLIC_APP_URL).origin
        )
          throw createAppError('AUTHORIZATION');
        return preserve(await server.handler(request));
      }),
    );
  return {
    GET: handle,
    POST: handle,
    PATCH: handle,
    PUT: handle,
    DELETE: handle,
  };
}
