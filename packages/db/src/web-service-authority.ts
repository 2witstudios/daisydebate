import { createAppError, createRefusal } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import type { BoundedTransactionContext } from './transaction-context';
import type { BoundedTransaction } from './bounded-transaction';
import { SERVICE_LEASE_WINDOW_MS } from './service-lease-lapse';

/**
 * Refuses unless this web instance's own lease is current. With `lock`, the
 * lease row is held to commit with FOR KEY SHARE: it fences the row's deletion
 * (the retention purge) but not the instance's own renewal, a non-key UPDATE,
 * so slow maintenance can never lapse the lease it runs under (DAISY-WEB-9).
 */
export async function requireCurrentWeb(
  tx: BoundedTransactionContext,
  instanceId: string,
  lock = false,
) {
  const rows =
    await tx.execute(sql`select instance_id from service_instances where instance_id=${instanceId} and role='web'
    and renewed_at>clock_timestamp()-${SERVICE_LEASE_WINDOW_MS}*interval '1 millisecond' ${lock ? sql`for key share` : sql``}`);
  if (rows.length !== 1)
    throw createRefusal(
      'AUTHORIZATION',
      'service-lease-lapsed',
      'Maintenance service is not current',
    );
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
