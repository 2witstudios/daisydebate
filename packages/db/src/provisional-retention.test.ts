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
      recheck: ['username', 'account_age', 'account_terms', 'actors'].every(
        (name) => text[1]?.includes(name),
      ),
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
