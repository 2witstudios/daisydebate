import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { requireRetentionBounds, type RetentionBatch } from './retention';
import {
  clearProvisionalLinks,
  type ProvisionalLinkPurposes,
} from './provisional-cleanup';

/**
 * An abandoned sign-up as of `before` (ISSUE-660): no username, not erased,
 * nothing that makes it more than a sign-up (an age, a Terms acceptance, an
 * actor, a role grant, a privacy job), and no activity since the cutoff: no
 * session created or refreshed, and no sign-in link sent to its email.
 */
const abandoned = (before: string, signInPurpose: string) => sql`
  username is null and deleted_at is null
  and not exists (select 1 from account_age where user_id = users.id)
  and not exists (select 1 from account_terms where user_id = users.id)
  and not exists (select 1 from actors where user_id = users.id)
  and not exists (select 1 from role_grants where user_id = users.id or granted_by_user_id = users.id)
  and not exists (select 1 from privacy_jobs where subject_ref = users.id)
  and not exists (select 1 from session where user_id = users.id
    and (created_at >= ${before}::timestamptz or updated_at >= ${before}::timestamptz))
  and not exists (select 1 from verification where created_at >= ${before}::timestamptz
    and case when starts_with(identifier, ${`${signInPurpose}:`})
      then lower(value::jsonb ->> 'email') = lower(users.email) else false end)`;

/**
 * ISSUE-660(b) and the #474 review: one unlocked, autocommitted read picks
 * up to `limit` candidates oldest first, then each account goes in its own
 * short transaction, so no transaction spans the batch (ADR 0032: a long one
 * holds back `pg_snapshot_xmin` for the outbox). That transaction locks the
 * row `SKIP LOCKED`, so a row a writer holds is skipped, then rechecks it in
 * a fresh statement: an age or Terms row committed by a transaction that
 * held the lock until just before ours changes no users row, so the locking
 * statement's own snapshot could miss it. Only then are its links cleared
 * and the account deleted; sessions, accounts and passkeys cascade.
 */
export const provisionalRetentionOperations = ({
  database,
  eventSink,
}: {
  readonly database: Pick<BunSQLDatabase, 'transaction' | 'execute'>;
  readonly eventSink: DatabaseEventSink | undefined;
}) => ({
  async purgeExpiredProvisionalUsers(
    input: RetentionBatch & ProvisionalLinkPurposes,
  ): Promise<number> {
    requireRetentionBounds(input);
    const eligible = abandoned(input.before, input.signInPurpose);
    return instrumented(eventSink, 'purgeExpiredProvisionalUsers', async () => {
      const candidates = (await database.execute(sql`
        select id from users where created_at < ${input.before}::timestamptz
          and (${eligible}) order by created_at, id limit ${input.limit}
      `)) as unknown as { id: string }[];
      let deleted = 0;
      for (const { id } of candidates)
        deleted += await database.transaction(async (tx) => {
          const [locked] = (await tx.execute(
            sql`select id from users where id = ${id} for update skip locked`,
          )) as unknown as { id: string }[];
          if (!locked) return 0;
          const [user] = (await tx.execute(
            sql`select id, email from users where id = ${id} and (${eligible})`,
          )) as unknown as { id: string; email: string | null }[];
          if (!user) return 0;
          await clearProvisionalLinks(tx, user, input);
          const rows = await tx.execute(
            sql`delete from users where id = ${id} returning id`,
          );
          return rows.length;
        });
      return deleted;
    });
  },
});
