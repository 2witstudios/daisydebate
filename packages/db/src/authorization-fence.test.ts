import { assert, setupRitewayBun, test } from 'riteway/bun';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import {
  loadAuthorizationAccount,
  lockAuthorizationActors,
  readAuthorizationActors,
  type AuthorizationTransaction,
} from './authorization';
import { factOfRow } from './room-command-operations.test-support';
setupRitewayBun();
const account = {
  userId: 'a'.repeat(24),
  actorId: 'b'.repeat(24),
  member: true,
  betaState: 'approved',
  betaRevision: 1,
  ageBand: 'adult',
  erased: false,
  revision: 1,
};
test('both account loaders use the canonical minimal function with distinct selector modes', async () => {
  const fact = factOfRow(account);
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
      facts: [fact, fact],
    },
  });
});

test('readers take the shared account fence; writers keep the exclusive one', async () => {
  const queries: string[] = [];
  const dialect = new PgDialect();
  const tx = {
    execute: async (query: SQL) => {
      queries.push(dialect.sqlToQuery(query).sql);
      return [account];
    },
  } as unknown as AuthorizationTransaction;
  const read = await readAuthorizationActors(tx, [account.actorId], {
    maxActors: 1,
  });
  await lockAuthorizationActors(tx, [account.actorId], { maxActors: 1 });
  assert({
    given: 'one read and one locked load of the same actor',
    should:
      'read through the shared-fence producer and lock through the exclusive one, with the same facts',
    actual: {
      shared: queries[0]?.includes(
        'public.daisy_authorization_read_accounts_v2(',
      ),
      exclusive:
        queries[1]?.includes('public.daisy_authorization_accounts_v2(') &&
        queries[1]?.includes('true'),
      fact: read[0],
    },
    expected: { shared: true, exclusive: true, fact: factOfRow(account) },
  });
});

test('the shared read refuses the same malformed selectors as the lock', async () => {
  const tx = {
    execute: async () => [],
  } as unknown as AuthorizationTransaction;
  const refused = await readAuthorizationActors(tx, ['not-an-id'], {
    maxActors: 1,
  }).catch((error: { code?: string }) => error.code);
  assert({
    given: 'a malformed actor id',
    should: 'refuse with VALIDATION before any query',
    actual: refused,
    expected: 'VALIDATION',
  });
});
