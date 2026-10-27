/** Where /beta shows that signing out did not happen. */
export const SIGN_OUT_FAILED_HREF = '/beta?signOut=failed';

const seeOther = (location: string) =>
  new Response(null, { status: 303, headers: { location } });

/**
 * POST /auth/sign-out, the sign-out for a native form (ISSUE-691, plan BETA
 * §5): it works without JavaScript. Same origin only (ADR 0020). It runs
 * Better Auth's own sign-out with the browser's headers, then answers 303
 * home carrying that response's cleared session cookies verbatim. A failed
 * sign-out goes back to /beta, still signed in, with a notice.
 */
export function createSignOutFormHandler({
  origin,
  signOut,
}: {
  readonly origin: () => string;
  /** Better Auth's mounted handler. */
  readonly signOut: (request: Request) => Promise<Response>;
}) {
  return async (request: Request): Promise<Response> => {
    if (request.headers.get('origin') !== new URL(origin()).origin)
      return new Response(null, { status: 403 });
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
    if (!response?.ok) return seeOther(SIGN_OUT_FAILED_HREF);
    const signedOut = seeOther('/');
    for (const cookie of response.headers.getSetCookie())
      signedOut.headers.append('set-cookie', cookie);
    return signedOut;
  };
}
