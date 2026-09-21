import { createAppError } from '@daisy/errors';
import { handleOperation, requireSameOrigin } from '../../server/http';
import { CLIENT_IP_HEADER } from './client-ip';
import { safeLocalDestination } from './redirect';

const CONFIRM_PATH = '/auth/confirm';
const NEW_USER_DESTINATION = '/onboarding/username';
const EXPIRED = `${CONFIRM_PATH}?error=INVALID_TOKEN`;
const MAX_FORM_BYTES = 4096;
const tokenShape = /^[A-Za-z0-9_-]{16,256}$/;
const emailShape = /^[^\s@<>"']{1,64}@[^\s@<>"']{1,255}$/;

type ConfirmDependencies = {
  readonly auth: () => {
    readonly handler: (request: Request) => Promise<Response>;
    readonly config: { readonly PUBLIC_APP_URL: string };
  };
};

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

/** Headers for every page that can carry or follow a credential. */
const pageHeaders = (extra: Record<string, string> = {}) => ({
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
  ...extra,
});

type View =
  | {
      readonly kind: 'confirm';
      readonly token: string;
      readonly hidden: Hidden;
      readonly notice?: string;
    }
  | {
      readonly kind: 'expired';
      readonly hidden: Hidden;
      readonly notice?: string;
    }
  | { readonly kind: 'sent' };
type Hidden = {
  readonly callbackURL: string;
  readonly newUserCallbackURL?: string;
};

const hiddenInputs = (hidden: Hidden) =>
  [
    `<input type="hidden" name="callbackURL" value="${escapeHtml(hidden.callbackURL)}">`,
    hidden.newUserCallbackURL
      ? `<input type="hidden" name="newUserCallbackURL" value="${escapeHtml(hidden.newUserCallbackURL)}">`
      : '',
  ].join('');

/** Server-rendered, script-free and asset-free: nothing to prefetch or leak. */
function page(view: View): string {
  const notice =
    'notice' in view && view.notice
      ? `<p role="alert">${escapeHtml(view.notice)}</p>`
      : '';
  let body: string;
  if (view.kind === 'confirm')
    body = `<h1>Confirm sign-in</h1>${notice}<p>Select the button to finish signing in to Daisy on this device.</p><form method="post" action="${CONFIRM_PATH}"><input type="hidden" name="token" value="${escapeHtml(view.token)}">${hiddenInputs(view.hidden)}<button type="submit">Sign in to Daisy</button></form>`;
  else if (view.kind === 'expired')
    body = `<h1>This sign-in link can no longer be used</h1>${notice}<p>Links expire after 5 minutes and work only once. Request a new link to continue; nothing is sent until you do.</p><form method="post" action="${CONFIRM_PATH}"><input type="hidden" name="intent" value="resend">${hiddenInputs(view.hidden)}<label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="email" required><button type="submit">Email me a new link</button></form>`;
  else
    body = `<h1>Check your email</h1><p>If that address can receive email, a new sign-in link is on its way. It expires in 5 minutes.</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="referrer" content="no-referrer"><meta name="robots" content="noindex"><title>Sign in — Daisy</title></head><body><main>${body}</main></body></html>`;
}

const html = (view: View, status = 200, extra: Record<string, string> = {}) =>
  new Response(page(view), { status, headers: pageHeaders(extra) });

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
  if (
    !request.headers
      .get('content-type')
      ?.startsWith('application/x-www-form-urlencoded')
  )
    throw createAppError('VALIDATION');
  const reader = request.body?.getReader();
  if (!reader) throw createAppError('VALIDATION');
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > MAX_FORM_BYTES) {
      await reader.cancel();
      throw createAppError('VALIDATION');
    }
    chunks.push(value);
  }
  return new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
}

export function createConfirmHandlers({ auth }: ConfirmDependencies) {
  /** Same-origin, identity-stamped sub-request into the mounted Better Auth router. */
  const forward = (request: Request, path: string, init: RequestInit) => {
    const server = auth();
    const headers = new Headers(init.headers);
    headers.set('origin', new URL(server.config.PUBLIC_APP_URL).origin);
    const client = request.headers.get(CLIENT_IP_HEADER);
    if (client) headers.set(CLIENT_IP_HEADER, client);
    return server.handler(
      new Request(new URL(path, server.config.PUBLIC_APP_URL), {
        ...init,
        headers,
      }),
    );
  };

  /** GET and HEAD only render: a scanner or prefetch can never redeem. */
  const view = (request: Request): Response => {
    const params = new URL(request.url).searchParams;
    const token = params.get('token');
    if (token && tokenShape.test(token))
      return html({ kind: 'confirm', token, hidden: hiddenFrom(params) });
    return html({
      kind: 'expired',
      hidden: hiddenFrom(params),
    });
  };

  const redeem = async (request: Request, form: URLSearchParams) => {
    const token = form.get('token') ?? '';
    const hidden = hiddenFrom(form);
    if (!tokenShape.test(token))
      return new Response(null, {
        status: 303,
        headers: { Location: EXPIRED },
      });
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
    const cookies = response.headers.getSetCookie();
    if (response.status === 429)
      return html(
        {
          kind: 'confirm',
          token,
          hidden,
          notice: 'Too many attempts. Wait a moment and try again.',
        },
        429,
        { 'Retry-After': response.headers.get('x-retry-after') ?? '60' },
      );
    const location = response.headers.get('location');
    if (
      response.status >= 300 &&
      response.status < 400 &&
      location &&
      cookies.length > 0
    ) {
      // Success: re-validate the target and drop everything but path+query.
      const target = new URL(location, request.url);
      const destination = safeLocalDestination(
        target.origin === new URL(request.url).origin
          ? `${target.pathname}${target.search}`
          : null,
      );
      const headers = new Headers({ Location: destination });
      for (const cookie of cookies) headers.append('set-cookie', cookie);
      return new Response(null, { status: 303, headers });
    }
    if (response.status >= 300 && response.status < 400)
      return new Response(null, {
        status: 303,
        headers: { Location: EXPIRED },
      });
    // Transient failure: keep the token in the (POST-only) form so the person
    // can retry, without ever placing it in a URL.
    return html(
      {
        kind: 'confirm',
        token,
        hidden,
        notice: 'We could not complete sign-in. Please try again.',
      },
      503,
      { 'Retry-After': '5' },
    );
  };

  const resend = async (request: Request, form: URLSearchParams) => {
    const email = (form.get('email') ?? '').trim();
    const hidden = hiddenFrom(form);
    if (!emailShape.test(email))
      return html(
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
    if (response.ok) return html({ kind: 'sent' });
    const body = (await response.json().catch(() => ({}))) as {
      code?: string;
      message?: string;
    };
    // Only the fixed, safe codes minted by the auth composition are shown.
    const known = new Set([
      'EMAIL_UNDELIVERABLE',
      'RATE_LIMITED',
      'EMAIL_DELIVERY_FAILED',
      'AUTH_TEMPORARILY_UNAVAILABLE',
    ]);
    const notice =
      body.code && known.has(body.code) && body.message
        ? body.message
        : response.status === 429
          ? 'Too many requests. Please try again later.'
          : 'We could not send the email. Please try again.';
    const extra: Record<string, string> = {};
    const retry =
      response.headers.get('retry-after') ??
      response.headers.get('x-retry-after');
    if (retry) extra['Retry-After'] = retry;
    return html(
      { kind: 'expired', hidden, notice },
      response.status === 429 || response.status === 422
        ? response.status
        : 503,
      extra,
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
        requireSameOrigin(request, auth().config.PUBLIC_APP_URL);
        const form = await readForm(request);
        return form.get('intent') === 'resend'
          ? resend(request, form)
          : redeem(request, form);
      }),
  };
}
