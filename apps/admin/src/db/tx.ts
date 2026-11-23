import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type { PgTransactionConfig } from 'drizzle-orm/pg-core';

/**
 * The statements an admin store runs, on the pool or inside a transaction.
 * It has no transaction controls: a store that needs its own transaction
 * takes an `AdminTxSource` and opens one with `inTransaction`. Raw
 * statements go through `query` and `run` in `raw-rows`, advisory locks
 * through `locks`. The admin database is its own (ADR 0077), so these are
 * the admin app's homes, not `@daisy/db`'s.
 */
export type AdminTx = Pick<
  BunSQLDatabase,
  'select' | 'selectDistinct' | 'insert' | 'update' | 'delete' | 'execute'
>;

/**
 * An open transaction, which only `inTransaction` hands out: what a write
 * that must commit with others, or a transaction-scoped lock, requires. The
 * pool is not one, so it cannot stand in where the lock must outlive a
 * single statement (the audit chain's append).
 */
export type AdminTransaction = Parameters<
  Parameters<BunSQLDatabase['transaction']>[0]
>[0];

/** A connection that can also open a transaction: the admin pool. */
export interface AdminTxSource extends AdminTx {
  readonly transaction: <T>(
    work: (tx: AdminTransaction) => Promise<T>,
    config?: PgTransactionConfig,
  ) => Promise<T>;
}

/** The one transaction opener: `work` runs inside a transaction of `source`. */
export const inTransaction = <T>(
  source: AdminTxSource,
  work: (tx: AdminTransaction) => Promise<T>,
  config?: PgTransactionConfig,
): Promise<T> => source.transaction(work, config);
