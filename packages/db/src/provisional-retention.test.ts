import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createTestDatabase } from './index.test-support';

setupRitewayBun();
const before = '2026-10-26T00:00:00.000Z';
const options = {
  signInPurpose: 'sign-in',
  recipientHashOf: (email: string) => `hash:${email}`,
};

test('provisional retention bounds work and rechecks protected facts after locking', async () => {
  const { database, queries } = createTestDatabase([
    [{ id: 'u'.repeat(24), email: 'unit@example.test' }],
    [],
  ]);
  const deleted = await database.purgeExpiredProvisionalUsers({
    before,
    limit: 2,
    ...options,
  });
  const text = queries.map(({ query }) => query);
  assert({
    given: 'a candidate that records an age before the post-lock snapshot',
    should:
      'lock a bounded oldest-first batch, recheck canonical protection and delete nothing',
    actual: {
      deleted,
      statements: text.length,
      bounded: text[0]?.includes('skip locked') && text[0]?.includes('limit'),
      recheck: [
        'username',
        'account_age',
        'account_terms',
        'actors',
        'role_grants',
        'privacy_jobs',
      ].every((name) => text[1]?.includes(name)),
      noDelete: text.every((query) => !query.trimStart().startsWith('delete')),
    },
    expected: {
      deleted: 0,
      statements: 2,
      bounded: true,
      recheck: true,
      noDelete: true,
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

test('eligible provisional cleanup uses exact mail owners and returns committed deletion counts', async () => {
  const user = { id: 'u'.repeat(24), email: 'unit@example.test' };
  const { database, queries } = createTestDatabase([
    [user],
    [user],
    [],
    [],
    [{ id: user.id }],
  ]);
  const deleted = await database.purgeExpiredProvisionalUsers({
    before,
    limit: 1,
    ...options,
  });
  const cleanup = queries[2]!;
  assert({
    given: 'an eligible locked provisional with an email address',
    should:
      'clean sign-in and both email-change subjects, remove only its keyed receipts and count the deleted user',
    actual: {
      deleted,
      statements: queries.length,
      selection: queries[0]?.params,
      subjects:
        cleanup.query.includes('email-change-approve:') &&
        cleanup.query.includes('email-change-verify:') &&
        cleanup.query.includes("'userId'"),
      owners: cleanup.params,
      receipt: queries[3]?.params,
      user: queries[4]?.params,
    },
    expected: {
      deleted: 1,
      statements: 5,
      selection: [before, 1],
      subjects: true,
      owners: ['sign-in:', user.email, user.id],
      receipt: [`hash:${user.email}`],
      user: [user.id],
    },
  });
});
