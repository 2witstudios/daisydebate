import { resolveIdentity, type Identity } from '@daisy/auth';
import { getAuth } from './auth';

/**
 * Principal resolution glue: Better Auth verifies the signed cookie and reads
 * the durable session row (its cookie cache is off, so revocation shows on
 * the next call); @daisy/auth decides what that session may do. This module
 * is shared by route handlers and server components, which pass the raw
 * Cookie header and nothing else.
 *
 * The read never refreshes: server components cannot set cookies, so a
 * refresh here would slide the database row while the browser kept the old
 * cookie. The sliding refresh runs in the browser through the real
 * `/api/auth/get-session` handler (ui/auth/session-refresh), which can.
 */
export async function identify(cookie: string | null): Promise<Identity> {
  const { instance, clock, logger } = getAuth();
  const identity = await resolveIdentity({
    cookie,
    now: () => clock.now(),
    readSession: async (header) => {
      const found = await instance.api.getSession({
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
