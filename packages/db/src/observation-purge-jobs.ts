import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';

type Execute = Pick<BunSQLDatabase, 'execute'>;

/** The first retry waits 1s; each later one doubles, at most 5 minutes. */
const observationPurgeBackoffMs = (attempts: number) =>
  Math.min(1_000 * 2 ** Math.max(0, attempts - 1), 300_000);
const MAX_BATCH = 128;

const instant = (value: string) => {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value)
    throw createAppError('VALIDATION');
  return date;
};

/**
 * Queues (or re-arms) one member's observation purge inside their erasure
 * transaction (ISSUE-852, ADR 0089): the obligation commits with the erasure
 * or not at all.
 */
export async function queueObservationPurge(
  tx: Execute,
  userId: string,
  now: string,
) {
  if (!idSchema.safeParse(userId).success) throw createAppError('VALIDATION');
  instant(now);
  await tx.execute(sql`insert into observation_purge_jobs(user_id, status, attempts, created_at, retry_at)
    values(${userId}, 'pending', 0, ${now}::timestamptz, ${now}::timestamptz)
    on conflict (user_id) do update set status = 'pending', retry_at = excluded.retry_at,
      created_at = excluded.created_at, succeeded_at = null`);
}

/**
 * Delivers every due pending purge with one confirmed cache purge, on a
 * committed pool (never the erasure transaction). The purge runs after the
 * due rows were read, so it covers every erasure they record. Success is
 * recorded only after `purge` resolves; a failure keeps each job pending
 * with exponential backoff, and nothing about the failure is stored.
 */
export async function deliverObservationPurges(
  database: Execute,
  input: { readonly now: string; readonly limit: number },
  port: { readonly purge: () => Promise<void> },
): Promise<{ readonly succeeded: number; readonly retried: number }> {
  const now = instant(input.now);
  if (
    !Number.isSafeInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > MAX_BATCH
  )
    throw createAppError('VALIDATION');
  const rows = (await database.execute(sql`select user_id as "userId", attempts,
      created_at as "createdAt"
    from observation_purge_jobs
    where status = 'pending' and retry_at <= ${input.now}::timestamptz
    order by retry_at, user_id limit ${input.limit}`)) as unknown as {
    userId: string;
    attempts: number;
    createdAt: Date;
  }[];
  if (rows.length === 0) return { succeeded: 0, retried: 0 };
  try {
    await port.purge();
  } catch {
    for (const row of rows) {
      const retryAt = new Date(
        now.getTime() + observationPurgeBackoffMs(row.attempts + 1),
      ).toISOString();
      await database.execute(sql`update observation_purge_jobs
        set attempts = attempts + 1, retry_at = ${retryAt}::timestamptz
        where user_id = ${row.userId} and status = 'pending'`);
    }
    return { succeeded: 0, retried: rows.length };
  }
  // Only the obligation that was read: a re-erasure committed after the
  // read (a newer created_at) stays pending for the next purge.
  for (const row of rows)
    await database.execute(sql`update observation_purge_jobs
      set status = 'succeeded', attempts = attempts + 1, succeeded_at = ${input.now}::timestamptz
      where user_id = ${row.userId} and status = 'pending'
        and created_at = ${row.createdAt.toISOString()}::timestamptz`);
  return { succeeded: rows.length, retried: 0 };
}
