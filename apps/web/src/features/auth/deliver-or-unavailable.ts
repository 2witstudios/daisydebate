import { unavailable } from './public-errors';
import type { AuthEmailMessage } from './mail-types';

export type Deliver = (message: AuthEmailMessage) => Promise<void>;

/**
 * The one place a mail send failure becomes the public, retryable
 * EMAIL_DELIVERY_FAILED outcome — used by every Better Auth mail hook
 * (sign-in, change-email-notice, change-email-confirm) instead of each
 * hook repeating its own try/catch.
 */
export const sendOrUnavailable = async (
  deliver: Deliver,
  message: AuthEmailMessage,
): Promise<void> => {
  try {
    await deliver(message);
  } catch {
    throw unavailable(
      'EMAIL_DELIVERY_FAILED',
      'We could not send the email. Please try again.',
    );
  }
};
