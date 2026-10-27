import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createTestDatabase } from './index.test-support';

setupRitewayBun();
const before = '2026-10-26T00:00:00.000Z';
const options = {
  signInPurpose: 'sign-in',
  emailChangePurposes: ['email-change-approve', 'email-change-verify'],
};
const user = { id: 'u'.repeat(24), email: 'unit@example.test' };

test('candidates come from one unlocked, bounded, oldest-first read of abandoned sign-ups', async () => {
  const { database, queries } = createTestDatabase([[]]);
  const deleted = await database.purgeExpiredProvisionalUsers({
    before,
    limit: 2,
    ...options,
  });
  const [read] = queries;
  assert({
    given: 'a cutoff, a batch limit and no candidates',
    should:
      'read once, without a lock, every protection including recent sessions and sign-in links, and delete nothing',
    actual: {
      deleted,
      statements: queries.length,
      unlocked: !read?.query.includes('for update'),
      bounded: /order by created_at, id limit \$\d+/.test(read?.query ?? ''),
      protections: [
        'username is null',
        'deleted_at is null',
        'account_age',
        'account_terms',
        'actors',
        'role_grants',
        'privacy_jobs',
        'from session',
        'from verification',
      ].filter((name) => !read?.query.includes(name)),
    },
    expected: {
      deleted: 0,
      statements: 1,
      unlocked: true,
      bounded: true,
      protections: [],
    },
  });
});

test('each candidate is locked skip-locked and rechecked in a fresh statement before anything goes', async () => {
  const skipped = createTestDatabase([[{ id: user.id }], []]);
  const protectedSince = createTestDatabase([
    [{ id: user.id }],
    [{ id: user.id }],
    [],
  ]);
  const counts = [
    await skipped.database.purgeExpiredProvisionalUsers({
      before,
      limit: 1,
      ...options,
    }),
    await protectedSince.database.purgeExpiredProvisionalUsers({
      before,
      limit: 1,
      ...options,
    }),
  ];
  const texts = protectedSince.queries.map(({ query }) => query);
  assert({
    given:
      'a candidate another writer holds, and one that recorded an age after it was read',
    should:
      'skip the held row, and for the other lock it, recheck every protection in a second statement and delete nothing',
    actual: {
      counts,
      lockSkips: skipped.queries[1]?.query.includes('for update skip locked'),
      recheck:
        texts[2]?.includes('account_age') && texts[2]?.includes('from session'),
      noDelete: [...skipped.queries, ...protectedSince.queries].every(
        ({ query }) => !query.trimStart().startsWith('delete'),
      ),
    },
    expected: {
      counts: [0, 0],
      lockSkips: true,
      recheck: true,
      noDelete: true,
    },
  });
});

test('an abandoned account loses its own links and the account, and keeps its delivery receipts', async () => {
  const { database, queries } = createTestDatabase([
    [{ id: user.id }],
    [{ id: user.id }],
    [user],
    [],
    [{ id: user.id }],
  ]);
  const deleted = await database.purgeExpiredProvisionalUsers({
    before,
    limit: 1,
    ...options,
  });
  const links = queries[3]!;
  assert({
    given: 'an abandoned account with an email address',
    should:
      'clear its sign-in and injected email-change links, delete the account, never touch email_delivery, and count it',
    actual: {
      deleted,
      statements: queries.length,
      linkOwners: links.params,
      purposesInjected: !links.query.includes('email-change-'),
      receiptsKept: queries.every(
        ({ query }) => !query.includes('email_delivery'),
      ),
      user: queries[4]?.params,
    },
    expected: {
      deleted: 1,
      statements: 5,
      linkOwners: [
        'sign-in:',
        user.email,
        'email-change-approve:',
        'email-change-verify:',
        user.id,
      ],
      purposesInjected: true,
      receiptsKept: true,
      user: [user.id],
    },
  });
});

test('provisional retention refuses bad bounds without querying', async () => {
  const { database, queries } = createTestDatabase([]);
  const refused = [];
  for (const input of [
    { before: 'invalid', limit: 2 },
    { before, limit: 0 },
    { before, limit: 1001 },
  ]) {
    try {
      await database.purgeExpiredProvisionalUsers({ ...input, ...options });
      refused.push(false);
    } catch (error) {
      refused.push((error as Error).message === 'Invalid retention bounds');
    }
  }
  assert({
    given: 'invalid cutoff, zero or excessive batch limit',
    should: 'refuse every request before database access',
    actual: [refused, queries.length],
    expected: [[true, true, true], 0],
  });
});
