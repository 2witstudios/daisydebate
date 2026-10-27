import { sql } from 'drizzle-orm';
import { loadAuthorizationAccount } from './authorization';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { accountAccessEvents, accountBetaAccess } from './schema/beta-access';
import { mailIntents } from './schema/mail-intents';

type Tx = Pick<BunSQLDatabase, 'insert'>;

/** The owner hears about new beta requests at most once per window (ADR 0075, P3). */
export const DIGEST_WINDOW = sql.raw(`interval '10 minutes'`);
const windowStart = sql`date_bin(${DIGEST_WINDOW}, now(), timestamptz '2000-01-01 00:00:00+00')`;

/**
 * Runs inside the username claim's transaction (ADR 0075): the account
 * joins the beta list as `pending`, its audit event is written, and the
 * current window's owner digest is owed. Only the first claim inserts; a
 * later call changes nothing. Gating reads this state; nothing here does.
 */
export async function enrolPendingBetaAccess(
  tx: Tx,
  userId: string,
  nextId: () => string,
): Promise<void> {
  const enrolled = await tx
    .insert(accountBetaAccess)
    .values({
      userId,
      state: 'pending',
      requestedAt: sql`now()`,
      provenance: 'signup',
    })
    .onConflictDoNothing()
    .returning({ userId: accountBetaAccess.userId });
  if (enrolled.length === 0) return;
  await tx.insert(accountAccessEvents).values({
    id: nextId(),
    userId,
    toState: 'pending',
    revision: 1,
    principal: 'signup',
  });
  await tx
    .insert(mailIntents)
    .values({
      id: nextId(),
      purpose: 'beta-requests-digest',
      dedupeKey: sql`'beta-requests:' || to_char(${windowStart} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"')`,
      windowStart: sql`${windowStart}`,
      // Sent once its window closes, so one email covers the whole window.
      nextAttemptAt: sql`${windowStart} + ${DIGEST_WINDOW}`,
    })
    .onConflictDoNothing({ target: mailIntents.dedupeKey });
}

/**
 * An account's participation facts for identity resolution (ADR 0075),
 * read through the canonical account function, never the raw tables: its
 * beta state and its age band now. Both null for an unknown account.
 */
export const betaAccessOperations = ({
  database,
  eventSink,
}: {
  readonly database: Pick<BunSQLDatabase, 'execute' | 'insert'>;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  getParticipationByUserId: (userId: string) =>
    instrumented(eventSink, 'getParticipationByUserId', async () => {
      const account = await loadAuthorizationAccount(database, userId);
      return {
        betaState: account?.beta?.state ?? null,
        ageBand: account?.ageBand ?? null,
      };
    }),
});
