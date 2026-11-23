import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type { PgTransactionConfig } from 'drizzle-orm/pg-core';

/** The statement methods an `AdminTx` carries. */
const adminTxMethods = [
  'select',
  'selectDistinct',
  'insert',
  'update',
  'delete',
  'execute',
] as const satisfies readonly (keyof BunSQLDatabase)[];

/**
 * The statements an admin store runs, on the pool or inside a transaction.
 * It has no transaction controls: a store that needs its own transaction
 * takes an `AdminTxSource` and opens one with `inTransaction`. Raw
 * statements go through `query` and `run` in `raw-rows`, advisory locks
 * through `locks`. The admin database is its own (ADR 0077), so these are
 * the admin app's homes, not `@daisy/db`'s.
 */
export type AdminTx = Pick<BunSQLDatabase, (typeof adminTxMethods)[number]>;

/** A connection that can also open a transaction: the admin pool. */
export interface AdminTxSource extends AdminTx {
  readonly transaction: <T>(
    work: (tx: AdminTx) => Promise<T>,
    config?: PgTransactionConfig,
  ) => Promise<T>;
}

/** The one transaction opener: `work` runs inside a transaction of `source`. */
export const inTransaction = <T>(
  source: AdminTxSource,
  work: (tx: AdminTx) => Promise<T>,
  config?: PgTransactionConfig,
): Promise<T> => source.transaction(work, config);
