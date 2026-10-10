import { assert, setupRitewayBun, test } from 'riteway/bun';
import { sql } from 'drizzle-orm';
import { createScriptedAuthorizationTransaction } from './testing';

setupRitewayBun();

test('scripted authorization transactions use real Drizzle query execution', async () => {
  const { tx, queries } = createScriptedAuthorizationTransaction([
    [{ actorId: 'actor', member: true }],
  ]);

  const result = await tx.execute(
    sql`select ${'actor'}::text as "actorId", true as member`,
  );

  assert({
    given: 'a scripted Bun wire response',
    should: 'build and execute through Drizzle while recording the bound query',
    actual: [result, queries.map(({ query, params }) => [query, params])],
    expected: [
      [{ actorId: 'actor', member: true }],
      [['select $1::text as "actorId", true as member', ['actor']]],
    ],
  });
});
