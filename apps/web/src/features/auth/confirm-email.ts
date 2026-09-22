import { handleOperation, requireSameOrigin } from '../../server/http';
import { renderEmailConfirmPage } from './confirm-email-page';
import {
  createForward,
  createViewHeadHandlers,
  readForm,
  redirect,
  type ConfirmAuth,
} from './confirm-http-shared';
import { safeLocalDestination } from './redirect';

const MAX_FORM_BYTES = 4096;
// Better Auth's email-verification token is a signed JWT: base64url segments
// joined by dots, longer than a magic-link's plain random string.
const tokenShape = /^[A-Za-z0-9_.-]{16,4096}$/;
const DEFAULT_DESTINATION = '/settings/security';

type ConfirmEmailDependencies = {
  readonly auth: () => ReturnType<ConfirmAuth> & {
    /**
     * One atomic revocation of every session for `userId` except
     * `keepToken` (`@daisy/db`'s single-statement DELETE) — no
     * snapshot-then-delete round trips for a concurrently created session
     * to slip through.
     */
    readonly revokeOtherSessions: (
      userId: string,
      keepToken: string,
    ) => Promise<number>;
  };
};

export function createConfirmEmailHandlers({ auth }: ConfirmEmailDependencies) {
  const forward = createForward(auth);

  const view = (request: Request): Response => {
    const params = new URL(request.url).searchParams;
    const token = params.get('token');
    const callbackURL = safeLocalDestination(
      params.get('callbackURL'),
      DEFAULT_DESTINATION,
    );
    return token && tokenShape.test(token)
      ? renderEmailConfirmPage({ kind: 'confirm', token, callbackURL })
      : renderEmailConfirmPage({ kind: 'expired' }, 400);
  };

  /**
   * When the redeemed hop set a session cookie (the final, new-address
   * verification step; the old-address approval step does not), the account
   * just proved live access to the new mailbox on this session. Every other
   * session for the account is revoked in one atomic statement, bypassing
   * the HTTP fresh-session gate that a genuinely stale concurrent session
   * could otherwise fail (AUTH-5.6).
   */
  /** True only once every other session for this account is confirmed gone. */
  const revokeOtherSessionsFor = async (
    request: Request,
    cookies: readonly string[],
  ): Promise<boolean> => {
    if (cookies.length === 0) return true;
    const cookieHeader = cookies
      .map((cookie) => cookie.split(';')[0])
      .join('; ');
    const sessionResponse = await forward(request, '/api/auth/get-session', {
      method: 'GET',
      headers: { cookie: cookieHeader },
    });
    if (!sessionResponse.ok) return false;
    const body = (await sessionResponse.json().catch(() => null)) as {
      session?: { token?: unknown; userId?: unknown };
    } | null;
    const token = body?.session?.token;
    const userId = body?.session?.userId;
    if (typeof token !== 'string' || typeof userId !== 'string') return false;
    try {
      await auth().revokeOtherSessions(userId, token);
      return true;
    } catch {
      return false;
    }
  };

  const redeem = async (request: Request, form: URLSearchParams) => {
    const token = form.get('token') ?? '';
    const callbackURL = safeLocalDestination(
      form.get('callbackURL'),
      DEFAULT_DESTINATION,
    );
    if (!tokenShape.test(token))
      return renderEmailConfirmPage({ kind: 'expired' }, 400);
    const response = await forward(
      request,
      `/api/auth/verify-email?${new URLSearchParams({ token })}`,
      { method: 'GET' },
    );
    if (!response.ok) return renderEmailConfirmPage({ kind: 'expired' }, 400);
    const cookies = response.headers.getSetCookie();
    const revoked = await revokeOtherSessionsFor(request, cookies);
    if (!revoked)
      return renderEmailConfirmPage(
        { kind: 'incomplete', callbackURL },
        502,
        cookies,
      );
    const headers = new Headers();
    for (const cookie of cookies) headers.append('set-cookie', cookie);
    return redirect(callbackURL, headers);
  };

  return {
    ...createViewHeadHandlers('auth.confirm_email.view', view),
    POST: (request: Request) =>
      handleOperation(request, 'auth.confirm_email.submit', async () => {
        requireSameOrigin(request, auth().config.PUBLIC_APP_URL);
        const form = await readForm(request, MAX_FORM_BYTES);
        return redeem(request, form);
      }),
  };
}
