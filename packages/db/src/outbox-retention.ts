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
    with boundary as (
      select txid, seq from outbox
      where txid < pg_snapshot_xmin(pg_current_snapshot())
        and created_at >= ${before}::timestamptz
      order by txid, seq limit 1
    ), prefix as (
      select o.seq from outbox o
      where o.txid < pg_snapshot_xmin(pg_current_snapshot())
        and o.created_at < ${before}::timestamptz
        and not exists (select 1 from boundary b where (o.txid, o.seq) >= (b.txid, b.seq))
      order by o.txid, o.seq limit ${limit}
      for update of o nowait
    ) delete from outbox where seq in (select seq from prefix) returning seq
  `);
  return (deleted as unknown as unknown[]).length;
}
