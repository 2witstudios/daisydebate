import type { GenericEndpointContext } from 'better-auth';
import { createAppError } from '@daisy/errors';
import { buildConfirmLink } from './confirm-link';
import { emailedLinkIdentifier } from './emailed-link-token';
import { renderAuthEmail } from './mail/templates';
import { sendOrUnavailable, type Deliver } from './deliver-or-unavailable';
import type { AfterResponse } from './after-response';

/**
 * The magic-link plugin's `sendMagicLink`. Every link spends the global
 * ceilings (`createSignUpCeiling`), whether or not its address has an
 * account, so the ceilings' remaining capacity never depends on one
 * (ISSUE-188). With room, the link is sent for any address and a failed
 * send is the retryable 503. Past a ceiling the request is answered at
 * once, before anything that depends on the account: the account lookup,
 * the sign-in send (ISSUE-54: an existing account is still mailed) and the
 * sign-up's dropped mail and deleted token all run after the answer
 * (`afterResponse`), so neither the answer nor its timing reveals which
 * addresses have accounts (ISSUE-182, ISSUE-185, ISSUE-189). A dropped
 * sign-up stands in for the send before it deletes its token, so both
 * hold the handed-off work's capacity alike (DEC-41).
 */
export const createSendMagicLink =
  (dependencies: {
    readonly origin: string;
    readonly deliver: Deliver;
    /** Spends the global ceilings; `false` when one is saturated. */
    readonly spendCeiling: () => Promise<boolean>;
    readonly afterResponse: AfterResponse;
    /** A dropped sign-up's stand-in for the send (`createSendStandIn`). */
    readonly standInForSend: (
      to: string,
      write: () => Promise<unknown>,
    ) => Promise<void>;
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
    const href = buildConfirmLink(dependencies.origin, data.url).toString();
    const send = () =>
      sendOrUnavailable(dependencies.deliver, {
        to: data.email,
        ...renderAuthEmail({ kind: 'sign-in', url: href }),
      });
    if (await dependencies.spendCeiling()) return send();
    const dropLink = () =>
      internalAdapter.deleteVerificationByIdentifier(
        emailedLinkIdentifier('sign-in', data.token),
      );
    dependencies.afterResponse(async () => {
      if (!(await internalAdapter.findUserByEmail(data.email))) {
        await dependencies.standInForSend(data.email, dropLink);
        return;
      }
      try {
        await send();
      } catch {
        // The delivery path has already logged the failure for operators.
        await dropLink();
      }
    });
  };
