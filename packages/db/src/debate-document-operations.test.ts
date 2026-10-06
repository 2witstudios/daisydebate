import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createTestDatabase } from './index.test-support';

setupRitewayBun();

const at = new Date('2026-10-05T18:00:00.000Z');
const save = {
  id: 'doc-1',
  ownerUserId: 'user-1',
  html: '<p>a</p>',
  expectedRevision: 3,
  updatedAt: at,
};

describe('saveDebateDocument', () => {
  test('a matching revision saves', async () => {
    const { database, queries } = createTestDatabase([[[4]]]);
    const result = await database.saveDebateDocument(save);
    assert({
      given: 'an update that matched the expected revision',
      should: 'report the bumped revision without a second read',
      actual: [result, queries.length],
      expected: [{ status: 'saved', revision: 4 }, 1],
    });
  });

  test('a stale revision conflicts', async () => {
    const { database } = createTestDatabase([[], [[5]]]);
    assert({
      given: 'no updated row and an owned document at revision 5',
      should: 'report a conflict with the current revision',
      actual: await database.saveDebateDocument(save),
      expected: { status: 'conflict', revision: 5 },
    });
  });

  test('an unknown or foreign document is missing', async () => {
    const { database } = createTestDatabase([[], []]);
    assert({
      given: 'no updated row and no owned document',
      should: 'report it missing',
      actual: await database.saveDebateDocument(save),
      expected: { status: 'missing' },
    });
  });
});

describe('renameDebateDocument', () => {
  test('an unknown or foreign document answers null', async () => {
    const { database } = createTestDatabase([[]]);
    assert({
      given: 'no renamed row',
      should: 'return null',
      actual: await database.renameDebateDocument({
        id: 'doc-1',
        ownerUserId: 'user-1',
        title: 'Plan',
        updatedAt: at,
      }),
      expected: null,
    });
  });
});
