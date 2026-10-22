import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { accountAgePrivacyAdopter } from './account-age';
import type { AuthorizationTransaction } from './authorization';

setupRitewayBun();
const input = {
  userId: 'u'.repeat(24),
  birthMonth: '2000-01',
  now: '2026-10-09T00:00:00.000Z',
};
function ageDatabase(responses: unknown[][]) {
  const remaining = [...responses];
  const queries: { sql: string; params: unknown[] }[] = [];
  const dialect = new PgDialect();
  const tx = {
    execute: async (statement: SQL) => {
      queries.push(dialect.sqlToQuery(statement));
      const result = remaining.shift();
      if (!result) throw new Error('Unexpected age query');
      return result;
    },
  } as unknown as AuthorizationTransaction;
  return { tx, queries };
}

test('age adopter binds own export/delete and keeps collection policies pending', async () => {
  const subject = { userId: input.userId, actorId: 'a'.repeat(24) };
  const fixture = ageDatabase([
    [],
    [
      {
        birthMonth: input.birthMonth,
        revision: 2,
        recordedAt: new Date(input.now),
      },
    ],
    [],
  ]);
  const empty = await accountAgePrivacyAdopter.export(fixture.tx, subject);
  const present = await accountAgePrivacyAdopter.export(fixture.tx, subject);
  await accountAgePrivacyAdopter.erase(fixture.tx, subject, { now: input.now });
  assert({
    given: 'an absent then present own age source',
    should: 'export only the bound source and delete only its user association',
    actual: [empty, present, fixture.queries.map(({ params }) => params[0])],
    expected: [
      { account_age: [] },
      {
        account_age: [
          {
            user_id: input.userId,
            birth_month: input.birthMonth,
            version: 2,
            recorded_at: input.now,
          },
        ],
      },
      [input.userId, input.userId, input.userId],
    ],
  });
  assert({
    given: 'pending age collection and retention decisions',
    should:
      'name the actual retention owner without granting collection approval',
    actual: accountAgePrivacyAdopter.fields.map(({ retention }) => retention),
    expected: Array.from({ length: 4 }, () => ({
      status: 'pending',
      decision: 'njiorsf64z4iqjm2dbfa3zuu',
    })),
  });
});
