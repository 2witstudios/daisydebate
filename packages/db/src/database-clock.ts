import { sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import type { BoundedTransactionContext } from './transaction-context';

/** Sample only after every fact/authority lock required by the caller. */
export async function readDatabaseTime(
  tx: Pick<BoundedTransactionContext, 'execute'>,
) {
  const rows = await tx.execute(sql`select clock_timestamp() as now`);
  const now = (rows[0] as { now: Date } | undefined)?.now;
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
    throw createAppError('INFRASTRUCTURE');
  return now;
}
