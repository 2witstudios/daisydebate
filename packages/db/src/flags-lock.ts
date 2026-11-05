import { createAppError } from '@daisy/errors';
import { sql } from 'drizzle-orm';
import type { FlagReadTransaction } from './flags-read';

/** Command -> account -> Flags -> rows. Never acquire an account after this lock. */
export async function lockFlags(
  tx: FlagReadTransaction,
  mode: 'read' | 'write',
) {
  const [isolation] = (await tx.execute(
    sql`select current_setting('transaction_isolation') as level`,
  )) as unknown as { level: string }[];
  if (isolation?.level !== 'read committed') throw createAppError('INVARIANT');
  // PostgreSQL 18 bounds the whole transaction as well as individual waits.
  await tx.execute(sql`select set_config('lock_timeout', '2000', true),
    set_config('statement_timeout', '5000', true),
    set_config('transaction_timeout', '5000', true)`);
  await tx.execute(
    mode === 'read'
      ? sql`select pg_advisory_xact_lock_shared(59118, 1)`
      : sql`select pg_advisory_xact_lock(59118, 1)`,
  );
}
