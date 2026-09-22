import type { BetterAuthPlugin } from 'better-auth';
import { createAuthMiddleware, isAPIError } from 'better-auth/api';

const REVOKE_PATHS = new Set([
  '/revoke-session',
  '/revoke-other-sessions',
  '/revoke-sessions',
]);

/**
 * RT-2.2 (plan revision 4.1): there is no Daisy-owned transaction around
 * these Better Auth session deletes, so this appends `session.revoked` in
 * its own short transaction right after a confirmed delete, not inside one.
 * The 60s continuous-authorization revalidation is the safety net for the
 * gap between the delete and this append. One doorbell per successful call,
 * not one per session revoked: `/revoke-other-sessions` and `/revoke-sessions`
 * (revoke-all, including the caller's own current session) may each delete
 * several sessions at once and Better Auth's response does not say how many,
 * and public/owner-topic payloads are doorbells, never enumerated deltas.
 * `/revoke-session` reports success even when the named token was not the
 * caller's own (a no-op delete), so an event can fire with nothing actually
 * revoked; that is a harmless extra doorbell on the caller's own topic, not
 * a false doorbell for someone else. The append is best-effort: a failure
 * is swallowed rather than left to propagate out of this `after` hook,
 * which would otherwise turn an already-completed revocation into a
 * reported endpoint failure.
 */
export const sessionRevokedOutboxPlugin = (
  appendSessionRevoked: (userId: string) => Promise<void>,
): BetterAuthPlugin => ({
  id: 'daisy-session-revoked-outbox',
  hooks: {
    after: [
      {
        matcher: (context) =>
          typeof context.path === 'string' && REVOKE_PATHS.has(context.path),
        handler: createAuthMiddleware(async (context) => {
          const returned = context.context.returned;
          const succeeded =
            !isAPIError(returned) &&
            typeof returned === 'object' &&
            returned !== null &&
            (returned as { status?: unknown }).status === true;
          const userId = context.context.session?.user.id;
          if (succeeded && typeof userId === 'string')
            await appendSessionRevoked(userId).catch(() => {});
        }),
      },
    ],
  },
});
