import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { parseTopic } from '@daisy/protocol';
import {
  decodeOutboxCursor,
  encodeOutboxCursor,
  type OutboxPosition,
  type OutboxRow,
} from './outbox';

const order = (a: string, b: string) => {
  const left = decodeOutboxCursor(a);
  const right = decodeOutboxCursor(b);
  return BigInt(left.txid) < BigInt(right.txid)
    ? -1
    : BigInt(left.txid) > BigInt(right.txid)
      ? 1
      : left.seq < right.seq
        ? -1
        : left.seq > right.seq
          ? 1
          : 0;
};
/** A conservative refusal is safe: absent/pruned history requires HTTP resync. */
export function catchupWindow({
  since,
  floor,
  through,
  count,
  limit,
}: {
  readonly since: string;
  readonly floor: string | null;
  readonly through: string;
  readonly count: number;
  readonly limit: number;
}) {
  return (
    floor !== null &&
    order(since, floor) >= 0 &&
    order(since, through) <= 0 &&
    count <= limit
  );
}

/** One statement/snapshot on the existing pool: retained floor and final rows
 * cannot race a prune. Cursor positions are ordering tokens, never authority.
 */
export async function readOutboxCatchup(
  database: Pick<BunSQLDatabase, 'execute'>,
  topic: string,
  since: string,
  through: OutboxPosition,
  limit = 500,
): Promise<{ readonly rows: readonly OutboxRow[]; readonly resync: boolean }> {
  if (!parseTopic(topic)) throw new Error('Invalid realtime topic');
  const after = decodeOutboxCursor(since);
  const throughCursor = encodeOutboxCursor(through);
  decodeOutboxCursor(throughCursor);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500)
    throw new Error('Invalid outbox catchup limit');
  const result = await database.execute(sql`
    with retained as (
      select txid, seq from outbox
      where txid < pg_snapshot_xmin(pg_current_snapshot())
      order by txid, seq limit 1
    ), replay as (
      select txid, seq, topic, kind, version, payload, created_at
      from outbox where topic = ${topic}
        and (txid, seq) > (${after.txid}::xid8, ${after.seq.toString()}::bigint)
        and (txid, seq) <= (${through.txid}::xid8, ${through.seq.toString()}::bigint)
        and txid < pg_snapshot_xmin(pg_current_snapshot())
      order by txid, seq limit ${limit + 1}
    ) select
      (select txid::text || ':' || seq::text from retained) as floor,
      coalesce((select jsonb_agg(jsonb_build_object(
        'txid', txid::text, 'seq', seq::text, 'topic', topic, 'kind', kind,
        'version', version, 'payload', payload, 'createdAt', created_at
      ) order by txid, seq) from replay), '[]'::jsonb) as rows
  `);
  const [record] = result as unknown as Array<{
    floor: string | null;
    rows: Array<Omit<OutboxRow, 'seq'> & { seq: string }>;
  }>;
  if (
    !record ||
    !catchupWindow({
      since,
      floor: record.floor,
      through: throughCursor,
      count: record.rows.length,
      limit,
    })
  )
    return { rows: [], resync: true };
  return {
    rows: record.rows.map((row) => ({ ...row, seq: BigInt(row.seq) })),
    resync: false,
  };
}
