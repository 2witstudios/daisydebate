import type { GenericEndpointContext } from 'better-auth';
import { createAppError } from '@daisy/errors';
import { buildConfirmLink } from './confirm-link';
import { emailedLinkIdentifier } from './emailed-link-token';
import { renderAuthEmail } from './mail/templates';
import { sendOrUnavailable, type Deliver } from './deliver-or-unavailable';

/**
 * The magic-link plugin's `sendMagicLink`: mails the sign-in link, except
 * that a link to an address with no account is a sign-up, metered by the
 * global ceilings (`createSignUpCeiling`). Saturated, the mail is dropped
 * and its unmailed token deleted, and the endpoint answers the same success
 * an existing account gets (ISSUE-182).
 */
export const createSendMagicLink =
  (dependencies: {
    readonly origin: string;
    readonly deliver: Deliver;
    readonly admitSignUp: () => Promise<boolean>;
  }) =>
  async (
    data: {
      readonly email: string;
      readonly url: string;
      readonly token: string;
    },
    context?: GenericEndpointContext,
  ): Promise<void> => {
    // Better Auth always passes the endpoint context; without it the
    // account lookup cannot run, so the send fails closed.
    if (!context) throw createAppError('INFRASTRUCTURE');
    const { internalAdapter } = context.context;
    if (
      !(await internalAdapter.findUserByEmail(data.email)) &&
      !(await dependencies.admitSignUp())
    ) {
      await internalAdapter.deleteVerificationByIdentifier(
        emailedLinkIdentifier('sign-in', data.token),
      );
      return;
    }
    const href = buildConfirmLink(dependencies.origin, data.url).toString();
    const message = renderAuthEmail({ kind: 'sign-in', url: href });
    await sendOrUnavailable(dependencies.deliver, {
      to: data.email,
      ...message,
    });
  };
