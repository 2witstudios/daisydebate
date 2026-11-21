import { SQL, type TransactionSQL } from 'bun';
import {
  savepointTestDatabase,
  type SavepointTestDatabase,
} from './testing-transaction';

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
      database: SavepointTestDatabase,
      seeded: Seeded,
      sql: TransactionSQL,
    ) => Promise<T>;
  },
): Promise<T> {
  const client = new SQL(url, { max: 1 });
  const answer: { value?: { readonly value: T } } = {};
  try {
    await client.begin(async (outer) => {
      const seeded = await steps.seed(outer);
      await outer`set local role daisy_web`;
      const database = savepointTestDatabase(outer);
      answer.value = { value: await steps.work(database, seeded, outer) };
      throw new RolledBack();
    });
  } catch (error) {
    if (!(error instanceof RolledBack)) throw error;
  } finally {
    await client.close();
  }
  if (!answer.value) throw new Error('The rolled-back work did not finish');
  return answer.value.value;
}
