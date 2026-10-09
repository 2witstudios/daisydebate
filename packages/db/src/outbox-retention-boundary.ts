import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { decodeOutboxCursor, type OutboxPosition } from './outbox';

/** Missing or invalid durable metadata cannot certify any replay history. */
export async function readOutboxRetentionBoundary(
  database: Pick<BunSQLDatabase, 'execute'>,
): Promise<OutboxPosition | null> {
  const rows = await database.execute(sql`
    select txid::text, seq::text from public.outbox_retention_boundary
    where singleton = true
  `);
  const records = rows as unknown as Array<{ txid: unknown; seq: unknown }>;
  if (records.length !== 1) return null;
  const row = records[0];
  if (!row || typeof row.txid !== 'string' || typeof row.seq !== 'string')
    return null;
  try {
    return decodeOutboxCursor(`${row.txid}:${row.seq}`);
  } catch {
    return null;
  }
}
