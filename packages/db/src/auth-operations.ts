import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { and, eq, ne, sql } from 'drizzle-orm';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { accounts, passkeys, sessions, verifications } from './schema/auth';
import { users } from './schema/users';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { appendSessionRevokedFor } from './session-revoked';
import { isUniqueViolation } from './unique-violation';

/** What an email-change completion did; `stale` changed nothing. */
export type EmailChangeCompletion = 'changed' | 'stale';

/**
 * The auth area (ISSUE-8 AC1): Better Auth's own adapter plus Daisy's
 * email-change completion and two session-revocation operations. Drizzle
 * stays inside this module; callers receive the adapter as an opaque
 * capability, never a table or a transaction handle.
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
     * ISSUE-99 (AUTH-5.6): the email change's final step, in one
     * transaction. It moves the account from `email` to `newEmail` (marked
     * verified, since the caller just proved the new inbox) and deletes every
     * outstanding emailed sign-in link whose subject is the old address, so a
     * link mailed there before the change can neither sign in to the account
     * nor, once the address is free, sign up a new account there. The links
     * are the rows whose identifier starts with `<signInPurpose>:` (the
     * caller's emailed-link purpose prefix, ADR 0025) and whose JSON value
     * names the old address, compared case-insensitively. `stale`, changing
     * nothing, when the account no longer holds `email` or `newEmail` is
     * taken in the meantime (the unique index decides a race).
     */
    async completeEmailChange(input: {
      readonly userId: string;
      readonly email: string;
      readonly newEmail: string;
      readonly signInPurpose: string;
    }): Promise<EmailChangeCompletion> {
      return instrumented(eventSink, 'completeEmailChange', async () => {
        try {
          return await database.transaction(async (tx) => {
            const moved = await tx
              .update(users)
              .set({
                email: input.newEmail,
                emailVerified: true,
                updatedAt: sql`now()`,
                version: sql`${users.version} + 1`,
              })
              .where(
                and(eq(users.id, input.userId), eq(users.email, input.email)),
              )
              .returning({ id: users.id });
            if (moved.length === 0) return 'stale';
            // CASE, not AND: Postgres may evaluate AND operands in any order,
            // and only rows of this purpose are guaranteed to hold JSON.
            await tx
              .delete(verifications)
              .where(
                sql`case when starts_with(${verifications.identifier}, ${`${input.signInPurpose}:`}) then lower(${verifications.value}::jsonb ->> 'email') = lower(${input.email}) else false end`,
              );
            return 'changed';
          });
        } catch (error) {
          if (isUniqueViolation(error)) return 'stale';
          throw error;
        }
      });
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
