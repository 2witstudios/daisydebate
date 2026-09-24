import type { BetterAuthPlugin, GenericEndpointContext } from 'better-auth';
import {
  APIError,
  createAuthEndpoint,
  sensitiveSessionMiddleware,
} from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import * as z from 'zod';
import type { Clock } from '@daisy/clock';
import { sendOrUnavailable, type Deliver } from './deliver-or-unavailable';
import {
  emailedLinkIdentifier,
  generateEmailedLinkToken,
  type EmailedLinkPurpose,
} from './emailed-link-token';
import { renderAuthEmail } from './mail/templates';

/** Same five-minute figure as a sign-in link (ADR 0025). */
export const EMAIL_CHANGE_LINK_EXPIRES_IN_SECONDS = 300;

/** The confirm page every email-change link opens (`confirm-email.ts`). */
export const CONFIRM_EMAIL_PATH = '/auth/confirm-email';

/** The one redemption path; only the confirm page's internal forward reaches it. */
export const EMAIL_CHANGE_VERIFY_PATH = '/email-change/verify';

/** Server-side subject of an email-change token; never inside the link. */
const claimSchema = z.object({
  userId: z.string(),
  email: z.string(),
  newEmail: z.string(),
});
type Claim = z.infer<typeof claimSchema>;

const invalidToken = () =>
  APIError.from('BAD_REQUEST', {
    code: 'INVALID_TOKEN',
    message: 'This link can no longer be used',
  });

/**
 * ISSUE-2: the recovery-email change (AUTH-5.6) on opaque stored tokens.
 * Better Auth 1.7.5's own `/change-email` and `/verify-email` put the
 * account, the new address and the step inside a signed JWT that is never
 * stored and cannot be revoked. Here each emailed link carries only a
 * 256-bit CSPRNG token; its SHA3-256 digest is stored under its purpose
 * (approve from the old inbox, then verify the new one) with the account,
 * both addresses and the expiry, and redemption consumes it atomically.
 *
 * `changeEmail` keeps Better Auth's key and path, so it replaces the core
 * endpoint outright (plugin endpoints are spread over the core set) and
 * every existing gate keyed on `/change-email` (fresh session, rate limit,
 * lifecycle event) still applies. `/verify-email` is disabled in `server.ts`.
 */
export const emailChangePlugin = (dependencies: {
  readonly origin: string;
  readonly deliver: Deliver;
  readonly clock: Clock;
}): BetterAuthPlugin => {
  const confirmLink = (token: string) => {
    const link = new URL(CONFIRM_EMAIL_PATH, dependencies.origin);
    link.searchParams.set('token', token);
    return link.toString();
  };
  const expiresAt = () =>
    new Date(
      Date.parse(dependencies.clock.now()) +
        EMAIL_CHANGE_LINK_EXPIRES_IN_SECONDS * 1000,
    );

  return {
    id: 'daisy-email-change',
    endpoints: {
      changeEmail: createAuthEndpoint(
        '/change-email',
        {
          method: 'POST',
          body: z.object({ newEmail: z.email() }),
          use: [sensitiveSessionMiddleware],
        },
        async (ctx) => {
          const { user } = ctx.context.session;
          const newEmail = ctx.body.newEmail.toLowerCase();
          if (newEmail === user.email.toLowerCase())
            throw APIError.from('BAD_REQUEST', {
              code: 'EMAIL_IS_THE_SAME',
              message: 'Email is the same',
            });
          // Same answer whether or not the address is taken: no disclosure.
          if (await ctx.context.internalAdapter.findUserByEmail(newEmail))
            return ctx.json({ status: true });
          const token = await issue(ctx, 'email-change-approve', {
            userId: user.id,
            email: user.email,
            newEmail,
          });
          await sendOrUnavailable(dependencies.deliver, {
            to: user.email,
            ...renderAuthEmail({
              kind: 'email-change-notice',
              url: confirmLink(token),
            }),
          });
          return ctx.json({ status: true });
        },
      ),
      verifyEmailChange: createAuthEndpoint(
        EMAIL_CHANGE_VERIFY_PATH,
        { method: 'POST', body: z.object({ token: z.string() }) },
        async (ctx) => {
          const { token } = ctx.body;
          const approved = await consume(ctx, 'email-change-approve', token);
          if (approved) {
            // The old inbox approved: prove the new one next.
            const next = await issue(ctx, 'email-change-verify', approved);
            await sendOrUnavailable(dependencies.deliver, {
              to: approved.newEmail,
              ...renderAuthEmail({
                kind: 'email-change-confirm',
                url: confirmLink(next),
              }),
            });
            return ctx.json({ status: true });
          }
          const verified = await consume(ctx, 'email-change-verify', token);
          if (!verified) throw invalidToken();
          const updated = await ctx.context.internalAdapter.updateUser(
            verified.userId,
            { email: verified.newEmail, emailVerified: true },
          );
          const session = await ctx.context.internalAdapter.createSession(
            verified.userId,
          );
          // Sets `newSession`, which the after hook in
          // `revokeOthersOnEmailChangePlugin` keeps while revoking the rest.
          await setSessionCookie(ctx, { session, user: updated });
          return ctx.json({ status: true });
        },
      ),
    },
  };

  async function issue(
    ctx: GenericEndpointContext,
    purpose: EmailedLinkPurpose,
    claim: Claim,
  ): Promise<string> {
    const token = generateEmailedLinkToken();
    await ctx.context.internalAdapter.createVerificationValue({
      identifier: emailedLinkIdentifier(purpose, token),
      value: JSON.stringify(claim),
      expiresAt: expiresAt(),
    });
    return token;
  }

  /**
   * Atomic, single-use and expiry-checked (Better Auth's
   * `consumeVerificationValue`). A claim whose account no longer holds the
   * old address, or whose new address was taken meanwhile, is void: the
   * token is spent either way.
   */
  async function consume(
    ctx: GenericEndpointContext,
    purpose: EmailedLinkPurpose,
    token: string,
  ): Promise<Claim | null> {
    const row = await ctx.context.internalAdapter.consumeVerificationValue(
      emailedLinkIdentifier(purpose, token),
    );
    if (!row) return null;
    const claim = claimSchema.parse(JSON.parse(row.value));
    const user = await ctx.context.internalAdapter.findUserById(claim.userId);
    if (!user || user.email !== claim.email) throw invalidToken();
    if (await ctx.context.internalAdapter.findUserByEmail(claim.newEmail))
      throw invalidToken();
    return claim;
  }
};
