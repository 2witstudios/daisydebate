import { sql } from 'drizzle-orm';
import { decodeOutboxCursor, type OutboxPosition } from './outbox';
import { outboxRetentionBoundary } from './schema/outbox-retention-boundary';
import type { Tx } from './tx';
import { query } from './raw-rows';
import { z } from 'zod';

/** Missing or invalid durable metadata cannot certify any replay history. */
export async function readOutboxRetentionBoundary(
  database: Tx,
): Promise<OutboxPosition | null> {
  const rows = await query(
    database,
    z.object({ txid: z.unknown(), seq: z.unknown() }),
    sql`
    select ${outboxRetentionBoundary.txid}::text as txid,
      ${outboxRetentionBoundary.seq}::text as seq
    from public.outbox_retention_boundary
    where ${outboxRetentionBoundary.singleton} = true
  `,
  );
  if (rows.length !== 1) return null;
  const row = rows[0];
  if (!row || typeof row.txid !== 'string' || typeof row.seq !== 'string')
    return null;
  try {
    return decodeOutboxCursor(`${row.txid}:${row.seq}`);
  } catch {
    return null;
  }
}
