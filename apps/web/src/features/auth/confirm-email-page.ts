import {
  confirmDocument,
  escapeHtml,
  hiddenInput,
  pageHeaders,
} from './confirm-page-shared';

const CONFIRM_EMAIL_PATH = '/auth/confirm-email';

export type EmailConfirmView =
  | {
      readonly kind: 'confirm';
      readonly token: string;
      readonly callbackURL: string;
    }
  | { readonly kind: 'expired' }
  | { readonly kind: 'done'; readonly callbackURL: string };

const confirmBody = (view: Extract<EmailConfirmView, { kind: 'confirm' }>) =>
  `<h1>Confirm this email change</h1><p>Select the button to continue changing this account's email.</p><form method="post" action="${CONFIRM_EMAIL_PATH}">${hiddenInput('token', view.token)}${hiddenInput('callbackURL', view.callbackURL)}<button type="submit">Continue</button></form>`;

const expiredBody =
  '<h1>This link can no longer be used</h1><p>It may have expired or already been used. Start the email change again from account security settings.</p>';

const doneBody = (view: Extract<EmailConfirmView, { kind: 'done' }>) =>
  `<h1>Done</h1><p>Continue to <a href="${escapeHtml(view.callbackURL)}">account security settings</a>.</p>`;

const bodyFor = (view: EmailConfirmView) =>
  view.kind === 'confirm'
    ? confirmBody(view)
    : view.kind === 'done'
      ? doneBody(view)
      : expiredBody;

/** Server-rendered, script-free and asset-free: nothing to prefetch or leak. */
export function renderEmailConfirmPage(
  view: EmailConfirmView,
  status = 200,
): Response {
  const document = confirmDocument('Confirm email — Daisy', bodyFor(view));
  return new Response(document, { status, headers: pageHeaders() });
}
