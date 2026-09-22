import { createAppError } from '@daisy/errors';
import { handleOperation, requireSameOriginForm } from '../../server/http';
import { readBoundedBody } from './bounded-body';
import { CLIENT_IP_HEADER } from './client-ip';
import { CONFIRM_PATH, renderConfirmPage, type Hidden } from './confirm-page';
import { safeLocalDestination } from './redirect';

const NEW_USER_DESTINATION = '/onboarding/username';
const EXPIRED = `${CONFIRM_PATH}?error=INVALID_TOKEN`;
const MAX_FORM_BYTES = 4096;
const tokenShape = /^[A-Za-z0-9_-]{16,256}$/;
const emailShape = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,255}$/;
/** Only fixed, safe codes minted by the auth composition are shown to people. */
const SHOWN_CODES = new Set([
  'EMAIL_UNDELIVERABLE',
  'RATE_LIMITED',
  'EMAIL_DELIVERY_FAILED',
  'AUTH_TEMPORARILY_UNAVAILABLE',
]);

type ConfirmDependencies = {
  readonly auth: () => {
    readonly handler: (request: Request) => Promise<Response>;
    readonly config: { readonly PUBLIC_APP_URL: string };
  };
};

const redirect = (location: string, headers = new Headers()) => {
  headers.set('Location', location);
  return new Response(null, { status: 303, headers });
};

const hiddenFrom = (params: URLSearchParams): Hidden => {
  const newUser = params.get('newUserCallbackURL');
  return {
    callbackURL: safeLocalDestination(params.get('callbackURL')),
    ...(newUser
      ? {
          newUserCallbackURL: safeLocalDestination(
            newUser,
            NEW_USER_DESTINATION,
          ),
        }
      : {}),
  };
};

async function readForm(request: Request): Promise<URLSearchParams> {
  const body = request.headers
    .get('content-type')
    ?.startsWith('application/x-www-form-urlencoded')
    ? await readBoundedBody(request, MAX_FORM_BYTES)
    : null;
  if (body === null) throw createAppError('VALIDATION');
  return new URLSearchParams(body.toString('utf8'));
}

/**
 * Success redirect: re-validate the target and keep only its path and query.
 * The target is compared with the deployment's public origin, never the
 * request's own: behind TLS termination the request arrives as plain HTTP.
 */
function signedInRedirect(response: Response, publicUrl: string) {
  const location = response.headers.get('location');
  const cookies = response.headers.getSetCookie();
  if (!location || cookies.length === 0) return null;
  const target = new URL(location, publicUrl);
  const sameOrigin = target.origin === new URL(publicUrl).origin;
  const headers = new Headers();
  for (const cookie of cookies) headers.append('set-cookie', cookie);
  return redirect(
    safeLocalDestination(
      sameOrigin ? `${target.pathname}${target.search}` : null,
    ),
    headers,
  );
}

const retryAfter = (response: Response) =>
  response.headers.get('retry-after') ?? response.headers.get('x-retry-after');

/** The safe public sentence for a failed resend. */
async function resendNotice(response: Response): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as {
    code?: string;
    message?: string;
  };
  if (body.code && SHOWN_CODES.has(body.code) && body.message)
    return body.message;
  return response.status === 429
    ? 'Too many requests. Please try again later.'
    : 'We could not send the email. Please try again.';
}

/**
 * Rate-limited or transient failure: keep the token in the POST-only form so
 * the person can retry, without ever placing it in a URL.
 */
function retryView(token: string, hidden: Hidden, response: Response) {
  const limited = response.status === 429;
  return renderConfirmPage(
    {
      kind: 'confirm',
      token,
      hidden,
      notice: limited
        ? 'Too many attempts. Wait a moment and try again.'
        : 'We could not complete sign-in. Please try again.',
    },
    limited ? 429 : 503,
    { 'Retry-After': (limited && retryAfter(response)) || '5' },
  );
}

export function createConfirmHandlers({ auth }: ConfirmDependencies) {
  /** Same-origin, identity-stamped sub-request into the mounted Better Auth router. */
  const forward = (request: Request, path: string, init: RequestInit) => {
    const server = auth();
    const headers = new Headers(init.headers);
    headers.set('origin', new URL(server.config.PUBLIC_APP_URL).origin);
    const client = request.headers.get(CLIENT_IP_HEADER);
    if (client) headers.set(CLIENT_IP_HEADER, client);
    // An unexpected framework failure becomes a plain 503 the views retry.
    return server
      .handler(
        new Request(new URL(path, server.config.PUBLIC_APP_URL), {
          ...init,
          headers,
        }),
      )
      .catch(() => new Response(null, { status: 503 }));
  };

  /** GET and HEAD only render: a scanner or prefetch can never redeem. */
  const view = (request: Request): Response => {
    const params = new URL(request.url).searchParams;
    const token = params.get('token');
    const hidden = hiddenFrom(params);
    return token && tokenShape.test(token)
      ? renderConfirmPage({ kind: 'confirm', token, hidden })
      : renderConfirmPage({ kind: 'expired', hidden });
  };

  const redeem = async (request: Request, form: URLSearchParams) => {
    const token = form.get('token') ?? '';
    const hidden = hiddenFrom(form);
    if (!tokenShape.test(token)) return redirect(EXPIRED);
    const query = new URLSearchParams({
      token,
      callbackURL: hidden.callbackURL,
      newUserCallbackURL: hidden.newUserCallbackURL ?? NEW_USER_DESTINATION,
      errorCallbackURL: EXPIRED,
    });
    const response = await forward(
      request,
      `/api/auth/magic-link/verify?${query}`,
      { method: 'GET' },
    );
    const signedIn = signedInRedirect(response, auth().config.PUBLIC_APP_URL);
    if (signedIn) return signedIn;
    if (response.status >= 300 && response.status < 400)
      return redirect(EXPIRED);
    return retryView(token, hidden, response);
  };

  const resend = async (request: Request, form: URLSearchParams) => {
    const email = (form.get('email') ?? '').trim();
    const hidden = hiddenFrom(form);
    if (!emailShape.test(email))
      return renderConfirmPage(
        { kind: 'expired', hidden, notice: 'Enter a valid email address.' },
        400,
      );
    const response = await forward(request, '/api/auth/sign-in/magic-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email,
        callbackURL: hidden.callbackURL,
        newUserCallbackURL: hidden.newUserCallbackURL ?? NEW_USER_DESTINATION,
      }),
    });
    if (response.ok) return renderConfirmPage({ kind: 'sent' });
    const retry = retryAfter(response);
    return renderConfirmPage(
      { kind: 'expired', hidden, notice: await resendNotice(response) },
      [422, 429].includes(response.status) ? response.status : 503,
      retry ? { 'Retry-After': retry } : {},
    );
  };

  return {
    GET: (request: Request) =>
      handleOperation(request, 'auth.confirm.view', async () => view(request)),
    HEAD: (request: Request) =>
      handleOperation(request, 'auth.confirm.view', async () => {
        const rendered = view(request);
        return new Response(null, {
          status: rendered.status,
          headers: rendered.headers,
        });
      }),
    POST: (request: Request) =>
      handleOperation(request, 'auth.confirm.submit', async () => {
        requireSameOriginForm(request, auth().config.PUBLIC_APP_URL);
        const form = await readForm(request);
        return form.get('intent') === 'resend'
          ? resend(request, form)
          : redeem(request, form);
      }),
  };
}
