import { createAppError } from '@daisy/errors';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { heldFlagLockModes, takeLock, transactionLocks } from './locks';
import { query, run } from './raw-rows';
import { isBoundedTransactionContext } from './transaction-context';
import type { Tx } from './tx';

/** Command -> account -> Flags -> rows. Never acquire an account after this lock. */
export async function lockFlags(tx: Tx, mode: 'read' | 'write') {
  const held = await heldFlagLockModes(tx);
  if (
    mode === 'write' &&
    held.some((lock) => lock.mode === 'ShareLock') &&
    !held.some((lock) => lock.mode === 'ExclusiveLock')
  )
    throw createAppError('INVARIANT');
  const [isolation] = await query(
    tx,
    z.object({ level: z.string() }),
    sql`select current_setting('transaction_isolation') as level`,
  );
  if (isolation?.level !== 'read committed') throw createAppError('INVARIANT');
  // The bounded transaction facade owns its settings and watchdog. Ordinary
  // Drizzle command/erasure/sweep transactions need the PostgreSQL backstop.
  if (!isBoundedTransactionContext(tx)) await boundFlagsTransaction(tx);
  await takeLock(
    tx,
    transactionLocks.flags(),
    mode === 'read' ? 'shared' : 'exclusive',
  );
}

async function boundFlagsTransaction(tx: Tx) {
  await run(
    tx,
    sql`select set_config(name,
      least(coalesce(nullif(setting::integer, 0), cap), cap)::text, true)
    from pg_settings join (values ('lock_timeout', 2000),
      ('statement_timeout', 5000), ('transaction_timeout', 5000))
      as limits(name, cap) using (name)`,
  );
}
