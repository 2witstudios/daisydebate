import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import {
  accountAgePrivacyAdopter,
  writeAccountBirthMonth,
} from './account-age';
import type { AuthorizationTransaction } from './authorization';

setupRitewayBun();
const input = {
  userId: 'u'.repeat(24),
  birthMonth: '2000-01',
  now: '2026-10-09T00:00:00.000Z',
  expectedAccountRevision: 3,
  expectedAgeRevision: null as number | null,
};
const authority = {
  status: 'approved' as const,
  decision: 'isolated test only',
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
  const database = {
    transaction: async <T>(
      work: (value: AuthorizationTransaction) => Promise<T>,
    ) => work(tx),
  } as Parameters<typeof writeAccountBirthMonth>[0];
  return { database, tx, queries };
}
const currentAccount = {
  userId: input.userId,
  actorId: 'a'.repeat(24),
  member: true,
  erased: false,
  revision: 3,
};
const user = { version: 3, deletedAt: null };

test('age correction binds both source and account revisions before writing', async () => {
  for (const existing of [false, true]) {
    const source = existing
      ? [
          {
            birthMonth: '1999-01',
            revision: 2,
            recordedAt: new Date(input.now),
          },
        ]
      : [];
    const fixture = ageDatabase([[user], [currentAccount], source, [], []]);
    const result = await writeAccountBirthMonth(
      fixture.database,
      { ...input, expectedAgeRevision: existing ? 2 : null },
      authority,
    );
    assert({
      given: existing ? 'a current correction' : 'an absent age source',
      should:
        'fence the account, check its membership and advance both revisions',
      actual: [
        result,
        fixture.queries.map(({ sql }) =>
          sql.includes('for update')
            ? 'lock'
            : sql.includes('daisy_authorization_accounts')
              ? 'member'
              : sql.startsWith('select')
                ? 'source'
                : sql.startsWith('insert')
                  ? 'age'
                  : 'account',
        ),
        fixture.queries[3]?.params.includes(input.birthMonth),
      ],
      expected: [
        { revision: existing ? 3 : 1, accountRevision: 4 },
        ['lock', 'member', 'source', 'age', 'account'],
        true,
      ],
    });
  }
});

test('stale age/account versions and unavailable membership cause no writes', async () => {
  const cases = [
    { rows: [[], [], []], code: 'AUTHORIZATION' },
    {
      rows: [[{ ...user, deletedAt: new Date(input.now) }]],
      code: 'AUTHORIZATION',
    },
    { rows: [[user], []], code: 'AUTHORIZATION' },
    {
      rows: [[user], [{ ...currentAccount, member: false }]],
      code: 'AUTHORIZATION',
    },
    {
      rows: [[{ ...user, version: 4 }], [currentAccount], []],
      code: 'CONFLICT',
    },
    {
      rows: [
        [user],
        [currentAccount],
        [
          {
            birthMonth: '1999-01',
            revision: 2,
            recordedAt: new Date(input.now),
          },
        ],
      ],
      code: 'CONFLICT',
    },
  ] as const;
  for (const item of cases) {
    const fixture = ageDatabase(item.rows.map((rows) => [...rows]));
    await assertRejects({
      given: 'stale or unavailable account/source facts',
      should: 'refuse without changing either source',
      actual: () => writeAccountBirthMonth(fixture.database, input, authority),
      code: item.code,
    });
    assert({
      given: 'a refused age correction',
      should: 'execute no write statement',
      actual: fixture.queries.some(({ sql }) => /^(insert|update)/.test(sql)),
      expected: false,
    });
  }
});

test('invalid age input and missing approval refuse before database access', async () => {
  const fixture = ageDatabase([]);
  for (const patch of [
    { userId: 'invalid' },
    { now: 'invalid' },
    { now: '2026-10-09' },
    { birthMonth: '2026-11' },
    { birthMonth: '2000-13' },
    { expectedAccountRevision: 0 },
    { expectedAgeRevision: -1 },
  ])
    await assertRejects({
      given: 'noncanonical input',
      should: 'refuse before a transaction query',
      actual: () =>
        writeAccountBirthMonth(
          fixture.database,
          { ...input, ...patch },
          authority,
        ),
      code: 'VALIDATION',
    });
  await assertRejects({
    given: 'an empty approval decision',
    should: 'remain unavailable',
    actual: () =>
      writeAccountBirthMonth(fixture.database, input, {
        ...authority,
        decision: ' ',
      }),
    code: 'AUTHORIZATION',
  });
  assert({
    given: 'all invalid inputs',
    should: 'perform no SQL',
    actual: fixture.queries.length,
    expected: 0,
  });
});

test('age adopter binds own export/delete and keeps collection policies pending', async () => {
  const subject = { userId: input.userId, actorId: currentAccount.actorId };
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
