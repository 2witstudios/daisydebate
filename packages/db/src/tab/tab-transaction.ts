import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';

/** The statements a Tab store runs inside its one fenced transaction. */
export type TabTransaction = Pick<
  BunSQLDatabase,
  'select' | 'insert' | 'update' | 'delete' | 'execute'
>;

/**
 * Where a Tab store opens its transaction: a lane's database, or a caller's
 * own transaction, in which the store's transaction is a savepoint.
 */
export type TabDatabase = {
  readonly transaction: <T>(
    work: (tx: TabTransaction) => Promise<T>,
  ) => Promise<T>;
};
