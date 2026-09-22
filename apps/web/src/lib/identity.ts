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
 * cookie. When a refresh is due, the root layout has the browser call the
 * real `/api/auth/get-session` handler (ui/auth/session-refresh), which can.
 */
export async function identify(requestHeaders: Headers): Promise<Identity> {
  return (await resolveSession(requestHeaders)).identity;
}

/**
 * The identity plus, for a live signed-in session, when it expires: the
 * server's input to deciding whether the browser should slide it now.
 */
export async function resolveSession(requestHeaders: Headers): Promise<{
  readonly identity: Identity;
  readonly sessionExpiresAt: string | null;
}> {
  const { instance, clock, logger } = getAuth();
  const cookie = requestHeaders.get('cookie');
  let expiresAt: string | null = null;
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
      expiresAt = new Date(session.expiresAt).toISOString();
      return {
        userId: user.id,
        emailVerified: user.emailVerified,
        username: typeof user.username === 'string' ? user.username : null,
        expiresAt,
      };
    },
  });
  if (identity.state === 'unavailable')
    logger.log(
      'auth.session.unavailable',
      { operation: 'auth.session.resolve', errorCode: 'INFRASTRUCTURE' },
      'Session store unavailable; request refused',
    );
  const signedIn =
    identity.state === 'provisional' || identity.state === 'member';
  return { identity, sessionExpiresAt: signedIn ? expiresAt : null };
}
