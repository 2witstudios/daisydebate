import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createObservationProjectionOperations } from './observation-projection';
setupRitewayBun();
const input = {
  base: {
    schema: 1 as const,
    resource: { kind: 'round' as const, id: 'r'.repeat(24) },
    partition: { kind: 'shared' as const, policyKey: 'round-clock-v1' },
    disclosureRevision: 1,
    window: { after: null, limit: 1 },
  },
  minimumContentRevision: 1,
  purgeGeneration: 0,
};
test('resource guard refuses before admission and rechecks after parent-fence waits', async () => {
  let transactions = 0,
    queries = 0,
    current = true;
  const database = {
    transaction: async (
      work: (tx: { execute: () => Promise<unknown[]> }) => Promise<unknown>,
    ) => {
      transactions++;
      return work({
        execute: async () => {
          queries++;
          current = false;
          return [];
        },
      });
    },
  } as unknown as BunSQLDatabase;
  const { readObservationProjection } =
    createObservationProjectionOperations(database);
  await assertRejects({
    given: 'a stale owner before admission',
    should: 'perform no transaction work',
    actual: () =>
      readObservationProjection({ ...input, isCurrent: () => false }),
    code: 'INFRASTRUCTURE',
  });
  assert({
    given: 'refused initial guard',
    should: 'start no transaction',
    actual: transactions,
    expected: 0,
  });
  await assertRejects({
    given: 'ownership expires during the parent fence',
    should: 'perform no resource body SQL',
    actual: () =>
      readObservationProjection({ ...input, isCurrent: () => current }),
    code: 'INFRASTRUCTURE',
  });
  assert({
    given: 'the post-wait resource guard',
    should: 'execute only the parent fence then roll back',
    actual: { transactions, queries },
    expected: { transactions: 1, queries: 1 },
  });
});
