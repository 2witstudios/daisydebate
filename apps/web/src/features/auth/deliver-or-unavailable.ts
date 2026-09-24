import { APIError } from 'better-auth/api';
import { unavailable } from './public-errors';
import type { AuthEmailMessage } from './mail-types';

/**
 * The one auth mail path (`createAuthServer`'s `sendMail`): `suppressed`
 * when the recipient hard-bounced or complained, so nothing was sent
 * (ADR 0025, ISSUE-54).
 */
export type Deliver = (
  message: AuthEmailMessage,
) => Promise<'sent' | 'suppressed'>;

/**
 * The one place a required mail's failure becomes a public outcome, used by
 * every Better Auth mail hook that cannot proceed without its mail
 * (sign-in, email-change-notice, email-change-confirm) instead of each hook
 * repeating its own try/catch: a send failure is the retryable
 * EMAIL_DELIVERY_FAILED, a suppressed recipient the same
 * EMAIL_UNDELIVERABLE the sign-in gate answers.
 */
export const sendOrUnavailable = async (
  deliver: Deliver,
  message: AuthEmailMessage,
): Promise<void> => {
  let outcome: Awaited<ReturnType<Deliver>>;
  try {
    outcome = await deliver(message);
  } catch {
    throw unavailable(
      'EMAIL_DELIVERY_FAILED',
      'We could not send the email. Please try again.',
    );
  }
  if (outcome === 'suppressed')
    throw new APIError('UNPROCESSABLE_ENTITY', {
      code: 'EMAIL_UNDELIVERABLE',
      message:
        'We cannot send email to this address. Sign in with a passkey or use a different address.',
    });
};
