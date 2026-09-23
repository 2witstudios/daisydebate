import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { and, eq, ne } from 'drizzle-orm';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { accounts, passkeys, sessions, verifications } from './schema/auth';
import { users } from './schema/users';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { appendSessionRevokedFor } from './session-revoked';

/**
 * The auth area (ISSUE-8 AC1): Better Auth's own adapter plus Daisy's two
 * session-revocation operations. Drizzle stays inside this module; callers
 * receive the adapter as an opaque capability, never a table or a
 * transaction handle.
 */
export const authOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => {
  const authAdapter = drizzleAdapter(database, {
    provider: 'pg',
    schema: {
      user: users,
      session: sessions,
      account: accounts,
      verification: verifications,
      passkey: passkeys,
    },
  });
  return {
    authAdapter,
    /**
     * RT-2.2 (plan revision 4.1, ADR 0032 §5): appends one `session.revoked`
     * outbox row in its own short transaction, for a caller that has already
     * confirmed a session delete outside Daisy's control (Better Auth's own
     * revoke endpoints). Never wraps the delete itself.
     */
    async appendSessionRevoked(userId: string): Promise<void> {
      return instrumented(eventSink, 'appendSessionRevoked', () =>
        database.transaction((tx) =>
          appendSessionRevokedFor(
            tx,
            userId,
            eventSink,
            'appendSessionRevoked',
          ),
        ),
      );
    },
    /**
     * Revokes every session for `userId` except `keepToken` in one atomic
     * DELETE — no snapshot-then-delete round trips, so a session created
     * concurrently with this call cannot slip through a listing window.
     * This is Daisy's own operation (AUTH-5.6's email-change completion),
     * not one of Better Auth's internal deletes, so the `session.revoked`
     * append happens in the *same* transaction as the DELETE (ADR 0032 §5,
     * plan revision 4.7): unlike the after-hook writers, a failed append
     * here rolls the DELETE back too, rather than being swallowed
     * best-effort. Returns the number of sessions removed.
     */
    async revokeOtherSessions(
      userId: string,
      keepToken: string,
    ): Promise<number> {
      return instrumented(eventSink, 'revokeOtherSessions', () =>
        database.transaction(async (tx) => {
          const rows = await tx
            .delete(sessions)
            .where(
              and(eq(sessions.userId, userId), ne(sessions.token, keepToken)),
            )
            .returning({ id: sessions.id });
          if (rows.length > 0)
            await appendSessionRevokedFor(
              tx,
              userId,
              eventSink,
              'revokeOtherSessions',
            );
          return rows.length;
        }),
      );
    },
  };
};
