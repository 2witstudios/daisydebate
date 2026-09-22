import type { BetterAuthPlugin } from 'better-auth';
import { createAuthMiddleware, isAPIError } from 'better-auth/api';
import type { Logger } from '@daisy/logger';

const REVOKE_PATHS = new Set([
  '/revoke-session',
  '/revoke-other-sessions',
  '/revoke-sessions',
]);

/**
 * The doorbell is best-effort (ADR 0032 §5: the 60s revalidation is the
 * safety net). A failure must never turn an already-completed revocation
 * into a reported failure, so it is caught here and logged as a registered
 * event instead of left to propagate into the caller's success path.
 */
export const appendSessionRevokedBestEffort = (
  appendSessionRevoked: (userId: string) => Promise<void>,
  logger: Logger,
  operation: string,
  userId: string,
): Promise<void> =>
  appendSessionRevoked(userId).catch(() => {
    logger.log(
      'realtime.outbox.append_failed',
      { operation, errorCode: 'INFRASTRUCTURE' },
      'Failed to append session.revoked to the outbox',
    );
  });

/**
 * RT-2.2 (plan revision 4.1, ADR 0032 §5): there is no Daisy-owned
 * transaction around these Better Auth session deletes, so this appends
 * `session.revoked` in its own short transaction right after a confirmed
 * delete, not inside one. One doorbell per successful call, not one per
 * session revoked: `/revoke-other-sessions` and `/revoke-sessions`
 * (revoke-all, including the caller's own current session) may each delete
 * several sessions at once and Better Auth's response does not say how many,
 * and public/owner-topic payloads are doorbells, never enumerated deltas.
 * `/revoke-session` reports success even when the named token was not the
 * caller's own (a no-op delete), so an event can fire with nothing actually
 * revoked; that is a harmless extra doorbell on the caller's own topic, not
 * a false doorbell for someone else.
 */
export const sessionRevokedOutboxPlugin = (
  appendSessionRevoked: (userId: string) => Promise<void>,
  logger: Logger,
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
            await appendSessionRevokedBestEffort(
              appendSessionRevoked,
              logger,
              'auth.session_revoked_outbox',
              userId,
            );
        }),
      },
    ],
  },
});
