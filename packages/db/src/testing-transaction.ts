import type { SQL, TransactionSQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type { TransactionConfig } from './tx';

/** Each operation is a savepoint; the enclosing proof chooses commit or rollback. */
export type SavepointTestDatabase = {
  readonly transaction: <T>(
    work: (tx: BunSQLDatabase) => Promise<T>,
  ) => Promise<T>;
};
export const savepointTestDatabase = (
  outer: TransactionSQL,
): SavepointTestDatabase => ({
  transaction: (work) =>
    outer.savepoint((savepoint) => work(drizzle({ client: savepoint as SQL }))),
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
    work: (tx: BunSQLDatabase) => Promise<T>,
    config?: TransactionConfig,
  ): Promise<T> =>
    drizzle({ client }).transaction(async (tx) => {
      await tx.execute(sql`set local role daisy_web`);
      return work(tx);
    }, config),
});
