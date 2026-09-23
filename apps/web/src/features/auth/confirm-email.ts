import type { Logger } from '@daisy/logger';
import { handleOperation, requireSameOrigin } from '../../server/http';
import { renderEmailConfirmPage } from './confirm-email-page';
import { SESSION_CLEANUP_FAILED_HEADER } from './revoke-others-on-verify-email';
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

type ConfirmEmailDependencies = { readonly auth: ConfirmAuth };

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

  const redeem = async (
    request: Request,
    form: URLSearchParams,
    logger: Logger,
  ) => {
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
    // Only the final hop (proving live access to the new mailbox) sets a
    // session cookie; the old-address approval hop hits this same route
    // without one. This redemption bypasses the mounted-route wrapper (it
    // forwards straight into Better Auth), so this is the one place the
    // milestone is observable: no token, cookie or address. The atomic
    // revoke of every other session (AUTH-5.6) now runs on the endpoint
    // itself (`revokeOthersOnVerifyEmailPlugin`, ISSUE-3 AC3), so it can no
    // longer be skipped by any caller of `/verify-email`; a failure there is
    // best-effort and flagged on the response rather than kept as a second,
    // skippable path here.
    if (cookies.length > 0) {
      logger.log(
        'auth.email_change.verified',
        { operation: 'auth.confirm_email.submit' },
        'Email change verified',
      );
      if (response.headers.get(SESSION_CLEANUP_FAILED_HEADER) === 'true')
        return renderEmailConfirmPage(
          { kind: 'incomplete', callbackURL },
          502,
          cookies,
        );
    }
    const headers = new Headers();
    for (const cookie of cookies) headers.append('set-cookie', cookie);
    return redirect(callbackURL, headers);
  };

  return {
    ...createViewHeadHandlers('auth.confirm_email.view', view),
    POST: (request: Request) =>
      handleOperation(
        request,
        'auth.confirm_email.submit',
        async (_id, logger) => {
          requireSameOrigin(request, auth().config.PUBLIC_APP_URL);
          const form = await readForm(request, MAX_FORM_BYTES);
          return redeem(request, form, logger);
        },
      ),
  };
}
