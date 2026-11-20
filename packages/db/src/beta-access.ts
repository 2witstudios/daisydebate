import { claimBetaPreapproval } from './beta-preapproval-claim';
import { sql } from 'drizzle-orm';
import { loadAuthorizationAccount } from './authorization';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { accountAccessEvents, accountBetaAccess } from './schema/beta-access';
import { mailIntents } from './schema/mail-intents';

type Tx = Pick<BunSQLDatabase, 'insert' | 'execute'>;

/** The owner hears about new beta requests at most once per window (ADR 0075, P3). */
export const DIGEST_WINDOW = sql.raw(`interval '10 minutes'`);
const windowStart = sql`date_bin(${DIGEST_WINDOW}, now(), timestamptz '2000-01-01 00:00:00+00')`;

/** Records the pending state and its audit event once under the account fence. */
export async function insertPendingBetaAccess(
  tx: Tx,
  userId: string,
  eventId: () => string,
): Promise<boolean> {
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
  if (enrolled.length === 0) return false;
  await tx.insert(accountAccessEvents).values({
    id: eventId(),
    userId,
    toState: 'pending',
    revision: 1,
    principal: 'signup',
  });
  return true;
}

/** The first username claim opens a beta request and queues its owner digest. */
export async function enrolPendingBetaAccess(
  tx: Tx,
  userId: string,
  nextId: () => string,
): Promise<void> {
  if (!(await insertPendingBetaAccess(tx, userId, nextId))) return;
  if (await claimBetaPreapproval(tx, userId)) return;
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
        restricted: account?.restricted ?? false,
      };
    }),
});
