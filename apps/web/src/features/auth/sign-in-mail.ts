import type { GenericEndpointContext } from 'better-auth';
import { createAppError } from '@daisy/errors';
import { buildConfirmLink } from './confirm-link';
import { emailedLinkIdentifier } from './emailed-link-token';
import { renderAuthEmail } from './mail/templates';
import { sendOrUnavailable, type Deliver } from './deliver-or-unavailable';

/**
 * The magic-link plugin's `sendMagicLink`. Every link spends the global
 * ceilings (`createSignUpCeiling`), whether or not its address has an
 * account, so the ceilings' remaining capacity never depends on one
 * (ISSUE-188). Only a sign-up (an address with no account) is held back:
 * past a ceiling its mail is dropped and its unmailed token deleted, while
 * a sign-in link is still sent (ISSUE-54). A saturated request's answer
 * never depends on delivery either: a sign-in send that fails there answers
 * the same success as a dropped sign-up (ISSUE-182, ISSUE-189). With room,
 * a failed send stays the retryable 503 for both.
 */
export const createSendMagicLink =
  (dependencies: {
    readonly origin: string;
    readonly deliver: Deliver;
    /** Spends the global ceilings; `false` when one is saturated. */
    readonly spendCeiling: () => Promise<boolean>;
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
    const withinCeiling = await dependencies.spendCeiling();
    const account = await internalAdapter.findUserByEmail(data.email);
    const dropLink = () =>
      internalAdapter.deleteVerificationByIdentifier(
        emailedLinkIdentifier('sign-in', data.token),
      );
    if (!account && !withinCeiling) {
      await dropLink();
      return;
    }
    const href = buildConfirmLink(dependencies.origin, data.url).toString();
    const message = renderAuthEmail({ kind: 'sign-in', url: href });
    const send = sendOrUnavailable(dependencies.deliver, {
      to: data.email,
      ...message,
    });
    if (withinCeiling) return send;
    try {
      await send;
    } catch {
      // The delivery path has already logged the failure for operators.
      await dropLink();
    }
  };
