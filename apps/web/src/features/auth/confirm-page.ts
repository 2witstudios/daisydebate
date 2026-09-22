import {
  confirmDocument,
  escapeHtml,
  hiddenInput,
  pageHeaders,
} from './confirm-page-shared';

export const CONFIRM_PATH = '/auth/confirm';

export type Hidden = {
  readonly callbackURL: string;
  readonly newUserCallbackURL?: string;
};
export type View =
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

const hiddenInputs = (hidden: Hidden) =>
  hiddenInput('callbackURL', hidden.callbackURL) +
  hiddenInput('newUserCallbackURL', hidden.newUserCallbackURL);

const noticeHtml = (notice: string | undefined) =>
  notice ? `<p role="alert">${escapeHtml(notice)}</p>` : '';

const confirmBody = (view: Extract<View, { kind: 'confirm' }>) =>
  `<h1>Confirm sign-in</h1>${noticeHtml(view.notice)}<p>Select the button to finish signing in to Daisy on this device.</p><form method="post" action="${CONFIRM_PATH}">${hiddenInput('token', view.token)}${hiddenInputs(view.hidden)}<button type="submit">Sign in to Daisy</button></form>`;

const expiredBody = (view: Extract<View, { kind: 'expired' }>) =>
  `<h1>This sign-in link can no longer be used</h1>${noticeHtml(view.notice)}<p>Links expire after 5 minutes and work only once. Request a new link to continue; nothing is sent until you do.</p><form method="post" action="${CONFIRM_PATH}">${hiddenInput('intent', 'resend')}${hiddenInputs(view.hidden)}<label for="email">Email address</label><input id="email" name="email" type="email" autocomplete="email" required><button type="submit">Email me a new link</button></form>`;

const sentBody =
  '<h1>Check your email</h1><p>If that address can receive email, a new sign-in link is on its way. It expires in 5 minutes.</p>';

const bodyFor = (view: View) =>
  ({ confirm: confirmBody, expired: expiredBody, sent: () => sentBody })[
    view.kind
  ](view as never);

/** Server-rendered, script-free and asset-free: nothing to prefetch or leak. */
export function renderConfirmPage(
  view: View,
  status = 200,
  extra: Record<string, string> = {},
): Response {
  const document = confirmDocument('Sign in — Daisy', bodyFor(view));
  return new Response(document, { status, headers: pageHeaders(extra) });
}
