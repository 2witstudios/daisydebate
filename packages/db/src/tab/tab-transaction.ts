import type { Tx } from '../tx';

/**
 * Where a Tab store opens its transaction: a lane's database, or a caller's
 * own transaction, in which the store's transaction is a savepoint.
 */
export type TabDatabase = {
  readonly transaction: <T>(work: (tx: Tx) => Promise<T>) => Promise<T>;
};
