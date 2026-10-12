import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { guardedObservationHeaders } from './observation-header-operation';
setupRitewayBun();
test('header ownership is checked after acquiring the actual transaction connection', async () => {
  let queries = 0,
    current = true;
  const database = {
    transaction: async (
      work: (tx: { execute: () => Promise<unknown[]> }) => Promise<unknown>,
    ) => {
      current = false;
      return work({
        execute: async () => {
          queries++;
          return [];
        },
      });
    },
  } as unknown as BunSQLDatabase;
  await assertRejects({
    given: 'an owner becomes stale during connection acquisition',
    should: 'refuse before resource header SQL begins',
    actual: () =>
      guardedObservationHeaders(
        database,
        [{ kind: 'room', id: 'r'.repeat(24) }],
        { isCurrent: () => current },
      ),
    code: 'INFRASTRUCTURE',
  });
  assert({
    given: 'post-connection refusal',
    should: 'execute no header statement',
    actual: queries,
    expected: 0,
  });
});
