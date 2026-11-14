import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';

/**
 * The tenant a transaction may reach: an organization, a lobby, and the
 * person whose own rows it may read. Each id comes from a row loaded by id
 * after `authorize` allowed the operation, never from client input.
 */
export type TenantScope = {
  readonly organizationId?: string;
  readonly lobbyId?: string;
  readonly subjectUserId?: string;
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
  await transaction.execute(sql`select
    set_config('daisy.organization_scope', ${scope.organizationId ?? ''}, true),
    set_config('daisy.lobby_scope', ${scope.lobbyId ?? ''}, true),
    set_config('daisy.subject_scope', ${scope.subjectUserId ?? ''}, true)`);
};

/**
 * Opens a transaction fenced to one scope. Row-level security is a fence,
 * not the decision: it stops a query that forgot its WHERE from reaching
 * another tenant's rows. The scope is transaction-local, so with none set,
 * or outside a transaction, every scoped predicate is null and no fenced
 * row is visible or writable.
 */
export const withScope = <T>(
  database: BunSQLDatabase,
  scope: TenantScope,
  run: (
    transaction: Parameters<Parameters<BunSQLDatabase['transaction']>[0]>[0],
  ) => Promise<T>,
): Promise<T> =>
  database.transaction(async (transaction) => {
    await scopeTransaction(transaction, scope);
    return run(transaction);
  });
