import { createAppError } from '@daisy/errors';
import { sql } from 'drizzle-orm';
import type { FlagReadTransaction } from './flags-read';

/** Command -> account -> Flags -> rows. Never acquire an account after this lock. */
export async function lockFlags(
  tx: FlagReadTransaction,
  mode: 'read' | 'write',
) {
  const [held] = (await tx.execute(
    sql`select current_setting('daisy.flags_lock', true) as mode`,
  )) as unknown as { mode: string | null }[];
  if (held?.mode === 'read' && mode === 'write')
    throw createAppError('INVARIANT');
  const [isolation] = (await tx.execute(
    sql`select current_setting('transaction_isolation') as level`,
  )) as unknown as { level: string }[];
  if (isolation?.level !== 'read committed') throw createAppError('INVARIANT');
  // PostgreSQL 18 bounds the whole transaction as well as individual waits.
  // Preserve stricter caller bounds (Billing's bounded control transaction).
  await tx.execute(sql`select set_config(name,
      least(coalesce(nullif(setting::integer, 0), cap), cap)::text, true)
    from pg_settings join (values ('lock_timeout', 2000),
      ('statement_timeout', 5000), ('transaction_timeout', 5000))
      as limits(name, cap) using (name)`);
  await tx.execute(
    mode === 'read'
      ? sql`select pg_advisory_xact_lock_shared(59118, 1)`
      : sql`select pg_advisory_xact_lock(59118, 1)`,
  );
  await tx.execute(
    sql`select set_config('daisy.flags_lock', ${held?.mode === 'write' ? 'write' : mode}, true)`,
  );
}
