import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { fakeSql } from '../index.test-support';
import { accountAgePrivacyAdopter } from '../account-age';
import { erasePrivacySubject } from './operations';
import type { PrivacyAdopter } from './contracts';

setupRitewayBun();
const subject = { userId: 'u'.repeat(24), actorId: 'a'.repeat(24) };
const account = { ...subject, revision: 1, member: true, erased: false };
const now = '2026-10-09T00:00:00.000Z';
const input = { subject, now, vendors: ['posthog'], jobIds: ['j'.repeat(24)] };
const bindings = [
  { purpose: 'sign-in', subject: 'email' as const },
  { purpose: 'reset', subject: 'userId' as const },
  {
    jsonTypes: ['registration', 'authentication'],
    subjectPath: ['userData', 'id'],
  },
];
const before: PrivacyAdopter = {
  ...accountAgePrivacyAdopter,
  id: 'test-associations',
  phase: 'before-auth',
  fields: accountAgePrivacyAdopter.fields.map((field) => ({
    ...field,
    table: 'test_associations',
  })),
  erase: async (tx, value) => {
    await tx.execute(
      sql`delete from test_associations where actor_id=${value.actorId}`,
    );
  },
  export: async () => ({ test_associations: [] }),
};
const adoption = {
  requiredAdopters: [before, accountAgePrivacyAdopter].map(
    ({ id, phase, fields }) => ({
      id,
      phase,
      expectedColumns: {
        [fields[0]!.table]: fields.map(({ column }) => column),
      },
    }),
  ),
  adopters: [before, accountAgePrivacyAdopter],
};

test('canonical erasure fences before associations and queues vendors after scrub', async () => {
  const fake = fakeSql([[account]]);
  const result = await erasePrivacySubject(
    drizzle({ client: fake.client }),
    input,
    adoption,
    bindings,
  );
  const queries = fake.queries.map(({ query }) => query.trim());
  assert({
    given:
      'configured adopters and producer-bound email/user/passkey challenges',
    should:
      'lock first, remove associations/tokens, scrub, erase age, then persist intent',
    actual: [
      result.alreadyErased,
      result.jobs.length,
      queries.map((query) =>
        query.includes('daisy_authorization_accounts')
          ? 'fence'
          : query.startsWith('delete from test_associations')
            ? 'associations'
            : query.startsWith('delete from verification')
              ? 'verification'
              : query.startsWith('delete from "session"')
                ? 'session'
                : query.startsWith('delete from "account"')
                  ? 'account'
                  : query.startsWith('delete from "passkey"')
                    ? 'passkey'
                    : query.startsWith('update users')
                      ? 'scrub'
                      : query.startsWith('delete from "account_age"')
                        ? 'age'
                        : 'intent',
      ),
    ],
    expected: [
      false,
      1,
      [
        'fence',
        'associations',
        'verification',
        'verification',
        'verification',
        'session',
        'account',
        'passkey',
        'scrub',
        'age',
        'intent',
      ],
    ],
  });
  assert({
    given: 'bound JSON challenges and a durable vendor intent',
    should:
      'guard JSON casting and bind the exact subject/purpose without secret payload storage',
    actual: [
      queries[4]?.includes('value is json object'),
      fake.queries[2]?.params.includes('sign-in:'),
      fake.queries[3]?.params.includes(subject.userId),
      fake.queries[4]?.params.includes('authentication'),
      fake.queries.at(-1)?.params.includes('posthog'),
    ],
    expected: [true, true, true, true, true],
  });
});

test('erased or foreign subject facts cannot trigger further cleanup or intents', async () => {
  const already = fakeSql([[{ ...account, erased: true, member: false }]]);
  const result = await erasePrivacySubject(
    drizzle({ client: already.client }),
    input,
    adoption,
    bindings,
  );
  assert({
    given: 'an already erased account',
    should: 'return idempotently after its fence',
    actual: [result, already.queries.length],
    expected: [{ alreadyErased: true, jobs: [] }, 1],
  });
  for (const rows of [[], [{ ...account, userId: 'z'.repeat(24) }]]) {
    const fake = fakeSql([rows]);
    await assertRejects({
      given: 'missing or foreign current subject binding',
      should: 'refuse before any cleanup',
      code: 'AUTHORIZATION',
      actual: () =>
        erasePrivacySubject(
          drizzle({ client: fake.client }),
          input,
          adoption,
          bindings,
        ),
    });
    assert({
      given: 'refused subject facts',
      should: 'issue only the canonical account fence',
      actual: fake.queries.length,
      expected: 1,
    });
  }
});

test('an adopter failure propagates without progressing to scrub or vendor intents', async () => {
  const failure = new Error('Injected adopter failure');
  const fake = fakeSql([[account], failure]);
  try {
    await erasePrivacySubject(
      drizzle({ client: fake.client }),
      input,
      adoption,
      bindings,
    );
    throw new Error('Erasure must refuse');
  } catch (error) {
    assert({
      given: 'failure in before-auth cleanup',
      should:
        'stop the transaction work without a vendor action or partial follow-up writes',
      actual: [
        error instanceof Error && error.cause === failure,
        fake.queries.length,
      ],
      expected: [true, 2],
    });
  }
});
