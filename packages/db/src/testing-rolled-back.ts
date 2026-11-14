import { SQL, type TransactionSQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';

/**
 * A database whose every transaction is a savepoint inside one outer
 * transaction that is always rolled back: append-only tables (action
 * history, results) leave nothing behind.
 */
export type RolledBackDatabase = {
  readonly transaction: <T>(
    work: (tx: BunSQLDatabase) => Promise<T>,
  ) => Promise<T>;
};

class RolledBack extends Error {}

/**
 * Test-only: opens one connection and one transaction, runs `seed` as the
 * migration owner (fixture accounts), then switches to the web runtime role
 * (`set local role daisy_web`) so row-level security binds as it does in
 * production, and runs `work`. Everything is rolled back, whatever `work`
 * answers or throws. `work` also gets the raw transaction, for assertions.
 */
export async function withRolledBackDatabase<Seeded, T>(
  url: string,
  steps: {
    readonly seed: (sql: TransactionSQL) => Promise<Seeded>;
    readonly work: (
      database: RolledBackDatabase,
      seeded: Seeded,
      sql: TransactionSQL,
    ) => Promise<T>;
  },
): Promise<T> {
  const client = new SQL(url, { max: 1 });
  let answer: { readonly value: T } | null = null;
  try {
    await client.begin(async (outer) => {
      const seeded = await steps.seed(outer);
      await outer`set local role daisy_web`;
      const database: RolledBackDatabase = {
        transaction: (work) =>
          outer.savepoint((savepoint) =>
            work(drizzle({ client: savepoint as SQL })),
          ),
      };
      answer = { value: await steps.work(database, seeded, outer) };
      throw new RolledBack();
    });
  } catch (error) {
    if (!(error instanceof RolledBack)) throw error;
  } finally {
    await client.close();
  }
  if (answer === null) throw new Error('The rolled-back work did not finish');
  return (answer as { readonly value: T }).value;
}
