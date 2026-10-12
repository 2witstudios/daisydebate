import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type { Tx } from './room-command-facts';

/** The common executor owns admission; this operation acquires only its transaction connection. */
export function roomCommandTransaction(database: BunSQLDatabase) {
  return <T>(run: (tx: Tx) => Promise<T>): Promise<T> =>
    database.transaction(run);
}
