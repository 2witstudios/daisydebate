import type { Logger } from '@daisy/logger';
import { readBoundedBody } from '../bounded-body';
import { returnableDestination } from '../redirect';

/** A sign-out form carries only `next`; anything larger is not one. */
const MAX_FORM_BYTES = 1024;

/**
 * Where a failed sign-out returns: the form's own page (`next`, held to the
 * shared local-destination rule), else /beta, with the notice flag added.
 */
const failedHref = (next: string | null): string => {
  const url = new URL(
    returnableDestination(next, '/beta'),
    'http://local.invalid',
  );
  url.searchParams.set('signOut', 'failed');
  return `${url.pathname}${url.search}`;
};

const nextOf = async (request: Request): Promise<string | null> => {
  const body = await readBoundedBody(request, MAX_FORM_BYTES).catch(() => null);
  return body === null
    ? null
    : new URLSearchParams(body.toString('utf8')).get('next');
};

const seeOther = (location: string) =>
  new Response(null, { status: 303, headers: { location } });

/**
 * POST /auth/sign-out, the sign-out for a native form (ISSUE-691, plan BETA
 * §5): it works without JavaScript. Same origin only (ADR 0020). It runs
 * Better Auth's own sign-out with the browser's headers, then answers 303 to /sign-in carrying that response's cleared session cookies verbatim. A failed
 * sign-out goes back to the form's page, still signed in, with a notice.
 */
export function createSignOutFormHandler({
  logger,
  origin,
  signOut,
}: {
  readonly logger: Logger;
  readonly origin: () => string;
  /** Better Auth's mounted handler. */
  readonly signOut: (request: Request) => Promise<Response>;
}) {
  return async (request: Request): Promise<Response> => {
    if (request.headers.get('origin') !== new URL(origin()).origin)
      return new Response(null, { status: 403 });
    const next = await nextOf(request);
    const headers = new Headers(request.headers);
    for (const name of ['content-length', 'transfer-encoding'])
      headers.delete(name);
    headers.set('content-type', 'application/json');
    const response = await signOut(
      new Request(new URL('/api/auth/sign-out', request.url), {
        method: 'POST',
        headers,
        body: '{}',
      }),
    ).catch(() => null);
    if (!response?.ok) {
      // A fixed event only: never the exception, the body or the cookie.
      logger.log(
        'auth.sign_out.failed',
        { operation: 'auth.sign_out' },
        'sign out failed',
      );
      return seeOther(failedHref(next));
    }
    const signedOut = seeOther('/sign-in');
    for (const cookie of response.headers.getSetCookie())
      signedOut.headers.append('set-cookie', cookie);
    return signedOut;
  };
}
