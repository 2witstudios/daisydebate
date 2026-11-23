import type { PgTransactionConfig } from 'drizzle-orm/pg-core';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';

/**
 * The statements a store runs: on a connection, inside a transaction, or
 * inside a lane's bounded writer. It has no transaction controls; a store
 * that needs its own transaction takes a `TxOpener` (or a `TxSource`) and
 * opens one with `inTransaction`. Raw statements go through `query` and
 * `run` in `raw-rows`.
 */
export type Tx = Pick<BunSQLDatabase, (typeof txMethods)[number]>;

/** The statement methods a `Tx` carries, which the bounded adapter binds. */
export const txMethods = [
  'select',
  'selectDistinct',
  'selectDistinctOn',
  'insert',
  'update',
  'delete',
  'execute',
] as const satisfies readonly (keyof BunSQLDatabase)[];

/** How a transaction is opened: isolation and access mode. */
export type TransactionConfig = PgTransactionConfig;

/** What opens a transaction whose statements run on `Scope`. */
export type TxOpener<Scope extends Tx = Tx> = {
  readonly transaction: <T>(
    work: (tx: Scope) => Promise<T>,
    config?: TransactionConfig,
  ) => Promise<T>;
};

/**
 * A connection that can also open a transaction: a lane's database, or a
 * caller's own transaction, in which the new one is a savepoint.
 */
export interface TxSource extends Tx, TxOpener<TxSource> {}

/** The one transaction opener: `work` runs inside a transaction of `source`. */
export const inTransaction = <T, Scope extends Tx>(
  source: TxOpener<Scope>,
  work: (tx: Scope) => Promise<T>,
  config?: TransactionConfig,
): Promise<T> => source.transaction(work, config);
/**
 * Retries only work whose facts moved under a concurrent write, each time
 * from fresh facts; past the last attempt, `exhausted` names the refusal.
 */
export async function retryStale<T>(
  attempt: () => Promise<T>,
  isStale: (error: unknown) => boolean,
  attempts: number,
  exhausted: () => Error,
): Promise<T> {
  for (let tried = 1; ; tried += 1) {
    try {
      return await attempt();
    } catch (error) {
      if (!isStale(error)) throw error;
      if (tried >= attempts) throw exhausted();
    }
  }
}

/** Runs `run` in one transaction it opens and settles: a writer's transaction runner. */
export type TransactionRunner = <T>(run: (tx: Tx) => Promise<T>) => Promise<T>;
