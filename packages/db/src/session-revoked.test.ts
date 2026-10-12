import { expect } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createTestDatabase, unreachableDatabase } from './index.test-support';

setupRitewayBun();

// Split from index.test.ts to keep each file under the lint's line limit.

describe('session revocation', () => {
  test('locks the user row, then revokes every other session in one statement and leaves the control to the session trigger', async () => {
    const userId = 'a7b3c9d1e5f2k4m6n8p1r3t5';
    const { database, queries } = createTestDatabase([
      [[userId]],
      [['session-row-id']],
    ]);

    const removed = await database.revokeOtherSessions(userId, 'keep-me');

    const lower = (index: number) => queries[index]?.query.toLowerCase() ?? '';
    assert({
      given: "a user's other sessions and the token to keep",
      should:
        'lock the user row first (ISSUE-22), then issue the DELETE with no listing query and no outbox statement of its own',
      actual: {
        removed,
        queryCount: queries.length,
        locksUserRow:
          lower(0).includes('"users"') && lower(0).endsWith('for update'),
        lockParams: queries[0]?.params,
        deletesSession: lower(1).includes('delete'),
        mentionsUserId: queries[1]?.query.includes('user_id'),
        mentionsToken: queries[1]?.query.includes('token'),
        params: queries[1]?.params,
      },
      expected: {
        removed: 1,
        queryCount: 2,
        locksUserRow: true,
        lockParams: [userId],
        deletesSession: true,
        mentionsUserId: true,
        mentionsToken: true,
        params: [userId, 'keep-me'],
      },
    });
  });

  test('revokes every session, the current one included, when no token is kept', async () => {
    const userId = 'a7b3c9d1e5f2k4m6n8p1r3t5';
    const { database, queries } = createTestDatabase([
      [[userId]],
      [['session-a'], ['session-b']],
    ]);

    const removed = await database.revokeOtherSessions(userId, null);

    assert({
      given: 'a revoke-all with no session to keep',
      should: 'delete by the user alone, under the same lock',
      actual: {
        removed,
        locksUserRow: queries[0]?.query.toLowerCase().endsWith('for update'),
        mentionsToken: queries[1]?.query.includes('token'),
        params: queries[1]?.params,
      },
      expected: {
        removed: 2,
        locksUserRow: true,
        mentionsToken: false,
        params: [userId],
      },
    });
  });

  test('reports a failed revocation through the injected event sink', async () => {
    const { database, events } = unreachableDatabase();

    await expect(
      database.revokeOtherSessions('user-1', 'keep-me'),
    ).rejects.toMatchObject({ code: 'ERR_POSTGRES_CONNECTION_REFUSED' });

    assert({
      given: 'a session revocation that fails',
      should: 'emit the database query failure event with the operation name',
      actual: events,
      expected: [
        {
          event: 'db.query.failed',
          fields: { operation: 'revokeOtherSessions' },
          message: 'Database query failed',
        },
      ],
    });
  });
});
