import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { requireRetentionBounds, type RetentionBatch } from './retention';
import {
  clearProvisionalMail,
  type ProvisionalMailCleanup,
} from './provisional-cleanup';

const provisional = sql`username is null and deleted_at is null
  and not exists (select 1 from account_age where user_id = users.id)
  and not exists (select 1 from account_terms where user_id = users.id)
  and not exists (select 1 from actors where user_id = users.id)`;

/** ISSUE-660(b): short, lock-skipping batches; a fresh snapshot protects completed onboarding. */
export const provisionalRetentionOperations = ({
  database,
  eventSink,
}: {
  readonly database: Pick<BunSQLDatabase, 'transaction'>;
  readonly eventSink: DatabaseEventSink | undefined;
}) => ({
  async purgeExpiredProvisionalUsers(
    input: RetentionBatch & ProvisionalMailCleanup,
  ): Promise<number> {
    requireRetentionBounds(input);
    return instrumented(eventSink, 'purgeExpiredProvisionalUsers', () =>
      database.transaction(async (tx) => {
        const candidates = (await tx.execute(sql`
        select id, email from users where created_at < ${input.before}::timestamptz
          and (${provisional}) order by created_at, id
        limit ${input.limit} for update skip locked
      `)) as unknown as { id: string; email: string | null }[];
        let deleted = 0;
        for (const user of candidates) {
          // A child age/Terms insert may have committed after the selection snapshot,
          // without changing the user row. Re-read after its lock has been acquired.
          const eligible = await tx.execute(
            sql`select id from users where id = ${user.id} and (${provisional})`,
          );
          if (eligible.length === 0) continue;
          await clearProvisionalMail(tx, user, input);
          const rows = await tx.execute(
            sql`delete from users where id = ${user.id} returning id`,
          );
          deleted += rows.length;
        }
        return deleted;
      }),
    );
  },
});
