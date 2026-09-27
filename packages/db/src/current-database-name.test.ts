import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createTestDatabase } from './index.test-support';

setupRitewayBun();

describe('currentDatabaseName', () => {
  test("reports the server's own answer, not a parsed URL", async () => {
    const { database } = createTestDatabase([
      [{ name: 'daisy_debate_staging' }],
    ]);

    assert({
      given: 'a database answering current_database()',
      should: 'report exactly that name',
      actual: await database.currentDatabaseName(),
      expected: 'daisy_debate_staging',
    });
  });
});
