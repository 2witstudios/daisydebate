import { assert, setupRitewayBun, test } from 'riteway/bun';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { SQL } from 'drizzle-orm';
import {
  readAuthorizationActors,
  type AuthorizationTransaction,
} from './authorization';

setupRitewayBun();

test('read account dependencies use a shared producer, including nested age and session producers', async () => {
  const queries: string[] = [];
  const dialect = new PgDialect();
  const tx = {
    execute: async (query: SQL) => {
      queries.push(dialect.sqlToQuery(query).sql);
      return [];
    },
  } as unknown as AuthorizationTransaction;
  await readAuthorizationActors(tx, ['a'.repeat(24)], { maxActors: 1 });
  const age = await Bun.file(
    new URL('./authorization-age.sql', import.meta.url),
  ).text();
  const shared = await Bun.file(
    new URL('./authorization-read-account-fence.sql', import.meta.url),
  ).text();
  assert({
    given: 'a protected reader and its age helper',
    should: 'take SHARE account fences without an UPDATE upgrade',
    actual: {
      sharedQuery: queries[0]?.includes('daisy_authorization_read_accounts'),
      sharedSql: shared.includes('FOR SHARE OF u'),
      ageShared: age.includes('daisy_authorization_read_accounts'),
      ageExclusive: age.includes('ARRAY[requested_actor_id], NULL::text, true'),
    },
    expected: {
      sharedQuery: true,
      sharedSql: true,
      ageShared: true,
      ageExclusive: false,
    },
  });
});
