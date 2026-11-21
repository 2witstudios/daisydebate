import type { SQL, TransactionSQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { sql } from 'drizzle-orm';
import { run } from './raw-rows';
import {
  inTransaction,
  type TransactionConfig,
  type Tx,
  type TxSource,
} from './tx';

/** The enclosing proof chooses commit or rollback for every operation. */
export type SavepointTestDatabase = {
  readonly transaction: <T>(work: (tx: TxSource) => Promise<T>) => Promise<T>;
};
export const savepointTestDatabase = (
  outer: TransactionSQL,
): SavepointTestDatabase => ({
  transaction: (work) =>
    outer.savepoint((savepoint) =>
      work(
        Object.assign(
          drizzle({ client: savepoint }),
          // A Drizzle session wrapped around a savepoint would open BEGIN.
          // Keep nested operations on the outer transaction's native opener.
          savepointTestDatabase(outer),
        ),
      ),
    ),
});

/** A real committed request boundary on the proof's own connection. */
export const withRuntimeTestTransaction = <T>(
  client: SQL,
  work: (frame: {
    readonly database: SavepointTestDatabase;
    readonly sql: TransactionSQL;
  }) => Promise<T>,
): Promise<T> =>
  client.begin(async (sql) => {
    await sql`set local role daisy_web`;
    return work({ database: savepointTestDatabase(sql), sql });
  });

/** Each call is a separately committed runtime request, including its decision callback. */
export const committingRuntimeTestDatabase = (client: SQL) => ({
  transaction: <T>(
    work: (tx: TxSource) => Promise<T>,
    config?: TransactionConfig,
  ): Promise<T> =>
    inTransaction(
      drizzle({ client }),
      async (tx) => {
        await run(tx, sql`set local role daisy_web`);
        return work(tx);
      },
      config,
    ),
});

const unexpected = (): never => {
  throw new Error('No statement expected');
};

/** A transaction no statement may reach; a test overrides what it expects. */
export const unusedTx: Tx = {
  select: unexpected,
  selectDistinct: unexpected,
  selectDistinctOn: unexpected,
  insert: unexpected,
  update: unexpected,
  delete: unexpected,
  execute: unexpected,
};
