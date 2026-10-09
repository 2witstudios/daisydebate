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
    with watermark as materialized (
      select txid, seq from public.outbox_retention_boundary
      where singleton = true for update nowait
    ), boundary as (
      select txid, seq from outbox
      where txid < pg_snapshot_xmin(pg_current_snapshot())
        and created_at >= ${before}::timestamptz
      order by txid, seq limit 1
    ), prefix as (
      select o.seq from outbox o cross join watermark
      where o.txid < pg_snapshot_xmin(pg_current_snapshot())
        and o.created_at < ${before}::timestamptz
        and not exists (select 1 from boundary b where (o.txid, o.seq) >= (b.txid, b.seq))
      order by o.txid, o.seq limit ${limit}
      for update of o nowait
    ), deleted as (
      delete from outbox where seq in (select seq from prefix) returning txid, seq
    ), maximum as (
      select txid, seq from deleted order by txid desc, seq desc limit 1
    ), advanced as (
      update public.outbox_retention_boundary b
      set txid = m.txid, seq = m.seq from maximum m
      where b.singleton = true and (b.txid, b.seq) < (m.txid, m.seq)
      returning b.seq
    ) select exists(select 1 from watermark) as known,
      (select count(*)::int from deleted) as count,
      (select count(*)::int from advanced) as advanced
  `);
  const [result] = deleted as unknown as Array<{
    known: boolean;
    count: number;
  }>;
  if (!result?.known) throw new Error('Outbox retention boundary unavailable');
  return result.count;
}
