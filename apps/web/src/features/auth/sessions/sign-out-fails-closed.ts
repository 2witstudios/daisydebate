import type { BetterAuthPlugin } from 'better-auth';
import { createAuthMiddleware } from 'better-auth/api';

/**
 * ISSUE-719: Better Auth 1.7.5's `/sign-out` catches a failed session
 * delete, logs it, clears the cookie and answers 200, so the server session
 * (and its realtime sockets) outlives a sign-out the person believes
 * succeeded. This hook deletes the signed-in session before the endpoint
 * runs and lets any failure propagate: the endpoint then never clears the
 * cookie or answers success, and the caller sees the outage and can retry.
 * On success the endpoint finds no session and only clears the cookie. The
 * delete's `session.revoked` control is the database trigger's, in the same
 * transaction (ADR 0032). A global `hooks.before` runs for the HTTP router
 * and `auth.api.signOut` alike.
 */
export const signOutFailsClosedPlugin: BetterAuthPlugin = {
  id: 'daisy-sign-out-fails-closed',
  hooks: {
    before: [
      {
        matcher: (context) => context.path === '/sign-out',
        handler: createAuthMiddleware(async (context) => {
          const token = await context.getSignedCookie(
            context.context.authCookies.sessionToken.name,
            context.context.secret,
          );
          if (token) await context.context.internalAdapter.deleteSession(token);
        }),
      },
    ],
  },
};
