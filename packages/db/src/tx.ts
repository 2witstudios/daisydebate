import type { PgTransactionConfig } from 'drizzle-orm/pg-core';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';

/**
 * The statements a store runs: on a connection, inside a transaction, or
 * inside a lane's bounded writer. It has no transaction controls; a store
 * that needs its own transaction takes a `TxSource` and opens one with
 * `inTransaction`. Raw statements go through `query` and `run` in `raw-rows`.
 */
export type Tx = Pick<
  BunSQLDatabase,
  | 'select'
  | 'selectDistinct'
  | 'selectDistinctOn'
  | 'insert'
  | 'update'
  | 'delete'
  | 'execute'
>;

/** How a transaction is opened: isolation and access mode. */
export type TransactionConfig = PgTransactionConfig;

/**
 * Where a transaction opens: a lane's database, or a caller's own
 * transaction, in which the new one is a savepoint.
 */
export type TxSource = Tx & {
  readonly transaction: <T>(
    work: (tx: TxSource) => Promise<T>,
    config?: TransactionConfig,
  ) => Promise<T>;
};

/** The one transaction opener: `work` runs inside a transaction of `database`. */
export const inTransaction = <T>(
  database: Pick<TxSource, 'transaction'>,
  work: (tx: TxSource) => Promise<T>,
  config?: TransactionConfig,
): Promise<T> => database.transaction(work, config);
