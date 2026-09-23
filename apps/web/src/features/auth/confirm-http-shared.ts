import { createAppError } from '@daisy/errors';
import { handleOperation } from '../../server/http';
import { readBoundedBody } from './bounded-body';
import { CLIENT_IP_HEADER } from './client-ip';

export type ConfirmAuth = () => {
  readonly handler: (request: Request) => Promise<Response>;
  readonly config: { readonly PUBLIC_APP_URL: string };
};

export const redirect = (location: string, headers = new Headers()) => {
  headers.set('Location', location);
  return new Response(null, { status: 303, headers });
};

/** Bounded form-body parsing shared by every confirm-page POST handler. */
export async function readForm(
  request: Request,
  maxBytes: number,
): Promise<URLSearchParams> {
  const body = request.headers
    .get('content-type')
    ?.startsWith('application/x-www-form-urlencoded')
    ? await readBoundedBody(request, maxBytes)
    : null;
  if (body === null) throw createAppError('VALIDATION');
  return new URLSearchParams(body.toString('utf8'));
}

/** Same-origin, identity-stamped sub-request into the mounted Better Auth router. */
export function createForward(auth: ConfirmAuth) {
  return (request: Request, path: string, init: RequestInit) => {
    const server = auth();
    const headers = new Headers(init.headers);
    headers.set('origin', new URL(server.config.PUBLIC_APP_URL).origin);
    const client = request.headers.get(CLIENT_IP_HEADER);
    if (client) headers.set(CLIENT_IP_HEADER, client);
    // An unexpected framework failure becomes a plain 503 the views retry.
    // `server.handler` now throws a typed INFRASTRUCTURE error on such a
    // failure (server.ts) rather than swallowing it to a bare 500 Response,
    // so this catch is the one place that failure is converted into the
    // graceful fallback the confirm pages already render for it.
    return server
      .handler(
        new Request(new URL(path, server.config.PUBLIC_APP_URL), {
          ...init,
          headers,
        }),
      )
      .catch(() => new Response(null, { status: 503 }));
  };
}

/** GET renders; HEAD renders the same status/headers with no body. Neither redeems. */
export function createViewHeadHandlers(
  operation: string,
  view: (request: Request) => Response,
) {
  return {
    GET: (request: Request) =>
      handleOperation(request, operation, async () => view(request)),
    HEAD: (request: Request) =>
      handleOperation(request, operation, async () => {
        const rendered = view(request);
        return new Response(null, {
          status: rendered.status,
          headers: rendered.headers,
        });
      }),
  };
}
