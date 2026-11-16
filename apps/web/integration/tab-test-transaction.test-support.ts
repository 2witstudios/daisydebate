import type { SQL, TransactionSQL } from 'bun';

const inTransaction = (client: SQL): client is TransactionSQL =>
  'savepoint' in client;
/** Rollback proofs nest a savepoint; committed private-database proofs own a real transaction. */
export const inTabTestTransaction = <T>(
  client: SQL,
  work: (sql: SQL) => Promise<T>,
): Promise<T> =>
  inTransaction(client) ? client.savepoint(work) : client.begin(work);
