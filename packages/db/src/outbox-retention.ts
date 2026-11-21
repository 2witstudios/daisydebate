import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type { RetentionBatch } from './retention';

/** Prune only a final commit-ordered prefix. A locked oldest row refuses the
 * entire statement (NOWAIT), rather than silently leaving a historical hole.
 * A fresh row stops pruning even when a later commit has an older timestamp.
 */
export async function deleteExpiredOutboxPrefix(
  database: Pick<BunSQLDatabase, 'execute'>,
  { before, limit }: RetentionBatch,
): Promise<number> {
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 500 ||
    Number.isNaN(Date.parse(before))
  )
    throw new Error('Invalid retention bounds');
  const deleted = await database.execute(sql`
    select * from public.daisy_prune_outbox_prefix(${before}::timestamptz, ${limit})
  `);
  const [result] = deleted as unknown as Array<{
    known: boolean;
    count: number;
  }>;
  if (!result?.known) throw new Error('Outbox retention boundary unavailable');
  return result.count;
}
