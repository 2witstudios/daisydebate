import { sql } from 'drizzle-orm';
import { requireRetentionBounds, type RetentionBatch } from './retention';
import type { Tx } from './tx';
import { query } from './raw-rows';
import { z } from 'zod';

/** Prune only a final commit-ordered prefix. A locked oldest row refuses the
 * entire statement (NOWAIT), rather than silently leaving a historical hole.
 * A fresh row stops pruning even when a later commit has an older timestamp.
 */
export async function deleteExpiredOutboxPrefix(
  database: Tx,
  { before, limit }: RetentionBatch,
): Promise<number> {
  requireRetentionBounds({ before, limit });
  const [result] = await query(
    database,
    z.object({ known: z.boolean(), count: z.int() }),
    sql`select * from public.daisy_prune_outbox_prefix(${before}::timestamptz, ${limit})`,
  );
  if (!result?.known) throw new Error('Outbox retention boundary unavailable');
  return result.count;
}
