import { createAppError } from '@daisy/errors';
import { sql } from 'drizzle-orm';
import { isBoundedTransactionContext } from './transaction-context';
import type { FlagReadTransaction } from './flags-read';

/** Command -> account -> Flags -> rows. Never acquire an account after this lock. */
export async function lockFlags(
  tx: FlagReadTransaction,
  mode: 'read' | 'write',
) {
  const held =
    (await tx.execute(sql`select mode from pg_locks where pid=pg_backend_pid()
    and locktype='advisory' and classid=59118 and objid=1 and objsubid=2 and granted`)) as unknown as {
      mode: string;
    }[];
  if (
    mode === 'write' &&
    held.some((lock) => lock.mode === 'ShareLock') &&
    !held.some((lock) => lock.mode === 'ExclusiveLock')
  )
    throw createAppError('INVARIANT');
  const [isolation] = (await tx.execute(
    sql`select current_setting('transaction_isolation') as level`,
  )) as unknown as { level: string }[];
  if (isolation?.level !== 'read committed') throw createAppError('INVARIANT');
  // The bounded transaction facade owns its settings and watchdog. Ordinary
  // Drizzle command/erasure/sweep transactions need the PostgreSQL backstop.
  if (!isBoundedTransactionContext(tx)) await boundFlagsTransaction(tx);
  await tx.execute(
    mode === 'read'
      ? sql`select pg_advisory_xact_lock_shared(59118, 1)`
      : sql`select pg_advisory_xact_lock(59118, 1)`,
  );
}

async function boundFlagsTransaction(tx: FlagReadTransaction) {
  await tx.execute(sql`select set_config(name,
      least(coalesce(nullif(setting::integer, 0), cap), cap)::text, true)
    from pg_settings join (values ('lock_timeout', 2000),
      ('statement_timeout', 5000), ('transaction_timeout', 5000))
      as limits(name, cap) using (name)`);
}
