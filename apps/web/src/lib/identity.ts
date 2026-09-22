import { resolveIdentity, type Identity } from '@daisy/auth';
import { hasSessionCookie } from '../features/auth/session-cookie';
import { getAuth } from './auth';

/**
 * Principal resolution glue: Better Auth verifies the signed cookie and reads
 * the durable session row (its cookie cache is off, so revocation shows on
 * the next call); @daisy/auth decides what that session may do. This module
 * is shared by route handlers and server components, which pass their
 * request headers; only the Cookie header is read.
 *
 * The read never refreshes: server components cannot set cookies, so a
 * refresh here would slide the database row while the browser kept the old
 * cookie. The sliding refresh runs in the browser through the real
 * `/api/auth/get-session` handler (ui/auth/session-refresh), which can.
 */
export async function identify(requestHeaders: Headers): Promise<Identity> {
  const { instance, clock, logger } = getAuth();
  const cookie = requestHeaders.get('cookie');
  const identity = await resolveIdentity({
    // No session cookie at all: nothing to look up, and no budget spent.
    cookie: hasSessionCookie(requestHeaders) ? cookie : null,
    now: () => clock.now(),
    readSession: async (header) => {
      const found = await instance.api.getSession({
        // A server Principal read: the rate-limit gate does not budget it
        // (features/auth/rate-limit.ts, isServerPrincipalRead).
        headers: new Headers({ cookie: header }),
        query: { disableRefresh: true },
      });
      if (!found) return null;
      const { user, session } = found;
      return {
        userId: user.id,
        emailVerified: user.emailVerified,
        username: typeof user.username === 'string' ? user.username : null,
        expiresAt: new Date(session.expiresAt).toISOString(),
      };
    },
  });
  if (identity.state === 'unavailable')
    logger.log(
      'auth.session.unavailable',
      { operation: 'auth.session.resolve', errorCode: 'INFRASTRUCTURE' },
      'Session store unavailable; request refused',
    );
  return identity;
}
