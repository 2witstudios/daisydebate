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
  | { readonly kind: 'done'; readonly callbackURL: string }
  | { readonly kind: 'incomplete'; readonly callbackURL: string };

const confirmBody = (view: Extract<EmailConfirmView, { kind: 'confirm' }>) =>
  `<h1>Confirm this email change</h1><p>Select the button to continue changing this account's email.</p><form method="post" action="${CONFIRM_EMAIL_PATH}">${hiddenInput('token', view.token)}${hiddenInput('callbackURL', view.callbackURL)}<button type="submit">Continue</button></form>`;

const expiredBody =
  '<h1>This link can no longer be used</h1><p>It may have expired or already been used. Start the email change again from account security settings.</p>';

const doneBody = (view: Extract<EmailConfirmView, { kind: 'done' }>) =>
  `<h1>Done</h1><p>Continue to <a href="${escapeHtml(view.callbackURL)}">account security settings</a>.</p>`;

const incompleteBody = (
  view: Extract<EmailConfirmView, { kind: 'incomplete' }>,
) =>
  `<h1>Email changed, but a cleanup step failed</h1><p>Your new email address is verified, but we could not confirm every other session was signed out. Continue to <a href="${escapeHtml(view.callbackURL)}">account security settings</a> and check the sessions list.</p>`;

const bodyFor = (view: EmailConfirmView) =>
  view.kind === 'confirm'
    ? confirmBody(view)
    : view.kind === 'done'
      ? doneBody(view)
      : view.kind === 'incomplete'
        ? incompleteBody(view)
        : expiredBody;

/** Server-rendered, script-free and asset-free: nothing to prefetch or leak. */
export function renderEmailConfirmPage(
  view: EmailConfirmView,
  status = 200,
  setCookies: readonly string[] = [],
): Response {
  const document = confirmDocument('Confirm email — Daisy', bodyFor(view));
  const headers = new Headers(pageHeaders());
  for (const cookie of setCookies) headers.append('set-cookie', cookie);
  return new Response(document, { status, headers });
}
