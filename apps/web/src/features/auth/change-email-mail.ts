import { buildConfirmEmailLink } from './confirm-email-link';
import { sendOrUnavailable, type Deliver } from './deliver-or-unavailable';
import { renderAuthEmail } from './mail/templates';

/**
 * Sent to the address still on file: approving from the old inbox is what
 * triggers the verification email to the new one (AUTH-5.6).
 */
export const sendChangeEmailConfirmation =
  (origin: string, deliver: Deliver) =>
  async ({
    user,
    newEmail,
    url,
  }: {
    user: { email: string };
    newEmail: string;
    url: string;
  }) => {
    const href = buildConfirmEmailLink(origin, url).toString();
    const message = renderAuthEmail({ kind: 'email-change-notice', url: href });
    await sendOrUnavailable(deliver, { to: user.email, ...message });
    void newEmail;
  };

/**
 * Used only by the change-email flow above: this deployment has no
 * password/email-verification signup, so nothing else can reach it.
 */
export const sendChangeEmailVerification =
  (origin: string, deliver: Deliver) =>
  async ({ user, url }: { user: { email: string }; url: string }) => {
    const href = buildConfirmEmailLink(origin, url).toString();
    const message = renderAuthEmail({
      kind: 'email-change-confirm',
      url: href,
    });
    await sendOrUnavailable(deliver, { to: user.email, ...message });
  };
