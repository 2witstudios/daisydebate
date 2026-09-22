import { resolveIdentity, type Identity } from '@daisy/auth';
import { getAuth } from './auth';

/**
 * Principal resolution glue: Better Auth verifies the signed cookie and reads
 * the durable session row (its cookie cache is off, so revocation shows on
 * the next call); @daisy/auth decides what that session may do. This module
 * is shared by route handlers and server components, which pass the raw
 * Cookie header and nothing else.
 */
export function identify(cookie: string | null): Promise<Identity> {
  const { instance, clock } = getAuth();
  return resolveIdentity({
    cookie,
    now: () => clock.now(),
    readSession: async (header) => {
      const found = await instance.api.getSession({
        headers: new Headers({ cookie: header }),
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
}
