import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import type { BoundedTransactionContext } from './transaction-context';
import type { BoundedTransaction } from './bounded-transaction';

export async function requireCurrentWeb(
  tx: BoundedTransactionContext,
  instanceId: string,
  lock = false,
) {
  const rows =
    await tx.execute(sql`select instance_id from service_instances where instance_id=${instanceId} and role='web'
    and renewed_at>clock_timestamp()-interval '3 seconds' ${lock ? sql`for share` : sql``}`);
  if (rows.length !== 1)
    throw createAppError('AUTHORIZATION', 'Maintenance service is not current');
}

/** A worker can lose authority while waiting for feature locks. Check both boundaries. */
export function currentWebTransaction(
  run: BoundedTransaction,
  instanceId: string,
): BoundedTransaction {
  if (!idSchema.safeParse(instanceId).success)
    throw createAppError('VALIDATION');
  return (work, options) =>
    run(async (...args) => {
      await requireCurrentWeb(args[0], instanceId);
      const result = await work(...args);
      await requireCurrentWeb(args[0], instanceId);
      return result;
    }, options);
}
