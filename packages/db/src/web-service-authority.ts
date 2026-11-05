import { createAppError } from '@daisy/errors';
import { sql } from 'drizzle-orm';
import type { BoundedTransactionContext } from './transaction-context';

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
