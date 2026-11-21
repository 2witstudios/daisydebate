import { assert, setupRitewayBun, test } from 'riteway/bun';
import { PgDialect } from 'drizzle-orm/pg-core';
import { deleteExpiredOutboxPrefix } from './outbox-retention';

setupRitewayBun();
test('outbox retention refuses invalid bounds before issuing a delete', async () => {
  let calls = 0;
  const database = {
    execute: async () => {
      calls += 1;
      return [];
    },
  } as unknown as Parameters<typeof deleteExpiredOutboxPrefix>[0];
  let failures = 0;
  for (const limit of [0, 501, 1.5]) {
    try {
      await deleteExpiredOutboxPrefix(database, {
        before: '2026-10-01T00:00:00.000Z',
        limit,
      });
    } catch {
      failures += 1;
    }
  }
  assert({
    given: 'unbounded or fractional deletion requests',
    should: 'reject without touching persistence',
    actual: { calls, failures },
    expected: { calls: 0, failures: 3 },
  });
});
test('prefix delete calls the bounded maintenance function once', async () => {
  let statement = '';
  const database = {
    execute: async (query: Parameters<PgDialect['sqlToQuery']>[0]) => {
      statement = new PgDialect().sqlToQuery(query).sql;
      return [{ known: true, count: 1 }];
    },
  } as unknown as Parameters<typeof deleteExpiredOutboxPrefix>[0];
  const count = await deleteExpiredOutboxPrefix(database, {
    before: '2026-10-01T00:00:00.000Z',
    limit: 1,
  });
  assert({
    given: 'the actual SQL adapter statement',
    should:
      'bound deletion behind the first fresh commit and lock without skipping',
    actual: {
      count,
      maintenance: statement.includes('public.daisy_prune_outbox_prefix'),
    },
    expected: { count: 1, maintenance: true },
  });
});
