import { buildConfirmEmailLink } from './confirm-email-link';
import { unavailable } from './public-errors';
import type { AuthEmailMessage } from './server';

type Deliver = (message: AuthEmailMessage) => Promise<void>;

const sendOrUnavailable = async (
  deliver: Deliver,
  message: AuthEmailMessage,
) => {
  try {
    await deliver(message);
  } catch {
    throw unavailable(
      'EMAIL_DELIVERY_FAILED',
      'We could not send the email. Please try again.',
    );
  }
};

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
    await sendOrUnavailable(deliver, {
      to: user.email,
      subject: 'Approve email change on Daisy',
      text: `Someone asked to change this account's email to ${newEmail}. If that was you, open this link to continue; it works once: ${href}`,
      html: `<p>Someone asked to change this account's email to ${newEmail}. If that was you, open this link to continue; it works once.</p><p><a href="${href.replaceAll('&', '&amp;')}">Approve the change</a></p><p>If you did not request this, no action is needed: nothing changes until this link is used.</p>`,
    });
  };

/**
 * Used only by the change-email flow above: this deployment has no
 * password/email-verification signup, so nothing else can reach it.
 */
export const sendChangeEmailVerification =
  (origin: string, deliver: Deliver) =>
  async ({ user, url }: { user: { email: string }; url: string }) => {
    const href = buildConfirmEmailLink(origin, url).toString();
    await sendOrUnavailable(deliver, {
      to: user.email,
      subject: 'Confirm your new email for Daisy',
      text: `Open this link to finish moving your Daisy account to this address. It works once: ${href}`,
      html: `<p>Open this link to finish moving your Daisy account to this address. It works once.</p><p><a href="${href.replaceAll('&', '&amp;')}">Confirm this email</a></p>`,
    });
  };
