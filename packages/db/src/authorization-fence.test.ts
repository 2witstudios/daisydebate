import { assert, setupRitewayBun, test } from 'riteway/bun';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import {
  loadAuthorizationAccount,
  lockAuthorizationActors,
  type AuthorizationTransaction,
} from './authorization';
setupRitewayBun();
test('both account loaders use the canonical minimal function with distinct selector modes', async () => {
  const account = {
    userId: 'a'.repeat(24),
    actorId: 'b'.repeat(24),
    member: true,
    erased: false,
    revision: 1,
  };
  const queries: { sql: string; params: unknown[] }[] = [];
  const dialect = new PgDialect();
  const tx = {
    execute: async (query: SQL) => {
      queries.push(dialect.sqlToQuery(query));
      return [{ ...account, username: 'not exposed' }];
    },
  } as unknown as AuthorizationTransaction;
  const locked = await lockAuthorizationActors(tx, [account.actorId], {
    maxActors: 1,
  });
  const read = await loadAuthorizationAccount(tx, account.userId);
  assert({
    given: 'the fenced actor loader and fresh user loader',
    should:
      'call the same minimal database producer without reading raw tables or returning extra fields',
    actual: {
      names: queries.map((q) =>
        q.sql.includes('public.daisy_authorization_accounts'),
      ),
      fenced: queries[0]?.sql.includes('null::text, true'),
      read:
        queries[1]?.sql.includes('null::text[]') &&
        queries[1]?.sql.includes('false'),
      params: queries.map((q) => q.params),
      facts: [locked[0], read],
    },
    expected: {
      names: [true, true],
      fenced: true,
      read: true,
      params: [[account.actorId], [account.userId]],
      facts: [account, account],
    },
  });
});
