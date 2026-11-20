import type { ReservedSQL } from 'bun';
import { scopeBoundedTransaction } from './transaction-context';
import { sql } from 'drizzle-orm';
import { inTransaction, type TxSource, type Tx } from './tx';
import { z } from 'zod';
import { query, run as runStatement } from './raw-rows';

/**
 * The tenant a transaction may reach: an organization, a lobby, and the
 * person whose own rows it may read. Each id comes from a row loaded by id
 * after `authorize` allowed the operation, never from client input.
 */
export type TenantScope = {
  readonly organizationId?: string | undefined;
  readonly lobbyId?: string | undefined;
  readonly subjectUserId?: string | undefined;
};

type ScopedExecutor = {
  readonly execute: (query: ReturnType<typeof sql>) => PromiseLike<unknown>;
};

/**
 * Sets the scope for the rest of a transaction that is already open. An
 * absent id clears that part, so a scope never outlives the step that set
 * it. Only this module names the scope settings.
 */
export const scopeTransaction = async (
  transaction: ScopedExecutor,
  scope: TenantScope,
): Promise<void> => {
  if (await scopeBoundedTransaction(transaction, scope)) return;
  await runStatement(
    transaction,
    sql`select
    set_config('daisy.organization_scope', ${scope.organizationId ?? ''}, true),
    set_config('daisy.lobby_scope', ${scope.lobbyId ?? ''}, true),
    set_config('daisy.subject_scope', ${scope.subjectUserId ?? ''}, true)`,
  );
};

/**
 * The scope the open transaction holds now, so a step that sets its own can
 * hand the caller's back. An unset part reads as absent.
 */
export const currentTenantScope = async (
  transaction: ScopedExecutor,
): Promise<TenantScope> => {
  const [row] = await query(
    transaction,
    z.object({
      organization: z.string().nullable(),
      lobby: z.string().nullable(),
      subject: z.string().nullable(),
    }),
    sql`select
    current_setting('daisy.organization_scope', true) as organization,
    current_setting('daisy.lobby_scope', true) as lobby,
    current_setting('daisy.subject_scope', true) as subject`,
  );
  return {
    organizationId: row?.organization || undefined,
    lobbyId: row?.lobby || undefined,
    subjectUserId: row?.subject || undefined,
  };
};

/**
 * Opens a transaction fenced to one scope. Row-level security is a fence,
 * not the decision: it stops a query that forgot its WHERE from reaching
 * another tenant's rows. The scope is transaction-local, so with none set,
 * or outside a transaction, every scoped predicate is null and no fenced
 * row is visible or writable.
 */
export const withScope = <T>(
  database: TxSource,
  scope: TenantScope,
  run: (transaction: Tx) => Promise<T>,
): Promise<T> =>
  inTransaction(database, async (transaction) => {
    await scopeTransaction(transaction, scope);
    return run(transaction);
  });

/** The bounded adapter owns the raw connection; scope vocabulary stays here. */
export async function scopeReservedTransaction(
  writer: ReservedSQL,
  scope: TenantScope,
): Promise<void> {
  await writer`select set_config('daisy.organization_scope', ${scope.organizationId ?? ''}, true),
    set_config('daisy.lobby_scope', ${scope.lobbyId ?? ''}, true),
    set_config('daisy.subject_scope', ${scope.subjectUserId ?? ''}, true)`;
}
