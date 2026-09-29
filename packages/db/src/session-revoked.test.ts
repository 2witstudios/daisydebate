import { expect } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  createTestDatabase,
  unreachableDatabase,
  type SinkEvent,
} from './index.test-support';

setupRitewayBun();

// Split from index.test.ts to keep each file under the lint's line limit.

describe('session revocation', () => {
  const actorId = 'z9y8x7w6v5u4t3s2r1q0p9o8';

  test('locks the user row, then revokes every other session in one atomic statement, resolving the actor and appending session.revoked in the same transaction', async () => {
    const userId = 'a7b3c9d1e5f2k4m6n8p1r3t5';
    const { database, queries } = createTestDatabase([
      [[userId]],
      [['session-row-id']],
      [[actorId]],
      [['5', '10']],
      [],
    ]);

    const removed = await database.revokeOtherSessions(userId, 'keep-me');

    const lower = (index: number) => queries[index]?.query.toLowerCase() ?? '';
    const selectsActor =
      lower(2).includes('select') && lower(2).includes('actors');
    const insertsOutbox =
      lower(3).includes('insert into') && lower(3).includes('outbox');

    assert({
      given: "a user's other sessions and the token to keep",
      should:
        'lock the user row first (ISSUE-22), then issue the DELETE with no listing query, resolve the actor, then append the outbox row and NOTIFY in the same transaction',
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
        selectsActor,
        insertsOutbox,
        notifies: lower(4).includes('pg_notify'),
      },
      expected: {
        removed: 1,
        queryCount: 5,
        locksUserRow: true,
        lockParams: [userId],
        deletesSession: true,
        mentionsUserId: true,
        mentionsToken: true,
        params: [userId, 'keep-me'],
        selectsActor: true,
        insertsOutbox: true,
        notifies: true,
      },
    });
  });

  test('revokes every session, the current one included, when no token is kept', async () => {
    const userId = 'a7b3c9d1e5f2k4m6n8p1r3t5';
    const { database, queries } = createTestDatabase([
      [[userId]],
      [['session-a'], ['session-b']],
      [[actorId]],
      [['5', '10']],
      [],
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

  test('revokes sessions but appends nothing and reports a registered event when the user has no actor row (never claimed a username)', async () => {
    const userId = 'a7b3c9d1e5f2k4m6n8p1r3t5';
    const events: SinkEvent[] = [];
    const { database, queries } = createTestDatabase(
      [[[userId]], [['session-row-id']], []],
      events,
    );

    const removed = await database.revokeOtherSessions(userId, 'keep-me');

    assert({
      given: 'a user with other sessions to revoke but no actor row',
      should:
        'still revoke the sessions, append no outbox row, and log realtime.outbox.actor_missing',
      actual: {
        removed,
        queryCount: queries.length,
        events: events.map(({ event, fields }) => ({ event, fields })),
      },
      expected: {
        removed: 1,
        queryCount: 3,
        events: [
          {
            event: 'realtime.outbox.actor_missing',
            fields: { operation: 'revokeOtherSessions' },
          },
        ],
      },
    });
  });

  test('appends no outbox row when there is nothing to revoke', async () => {
    const userId = 'a7b3c9d1e5f2k4m6n8p1r3t5';
    const { database, queries } = createTestDatabase([[[userId]], []]);

    const removed = await database.revokeOtherSessions(userId, 'keep-me');

    assert({
      given: 'a user with no other sessions to revoke',
      should:
        'issue only the lock and the DELETE, appending nothing to the outbox',
      actual: { removed, queryCount: queries.length },
      expected: { removed: 0, queryCount: 2 },
    });
  });

  test('appendSessionRevoked (the single-session /revoke-session path) appends nothing and reports the same registered event for a provisional user with no actor row (ISSUE-167)', async () => {
    const userId = 'a7b3c9d1e5f2k4m6n8p1r3t5';
    const events: SinkEvent[] = [];
    const { database, queries } = createTestDatabase([[]], events);

    await database.appendSessionRevoked(userId);

    assert({
      given:
        'a provisional user (never claimed a username, so no actors row) whose single session Better Auth already deleted',
      should:
        'look the actor up, append no outbox row, and log realtime.outbox.actor_missing',
      actual: {
        queryCount: queries.length,
        events: events.map(({ event, fields }) => ({ event, fields })),
      },
      expected: {
        queryCount: 1,
        events: [
          {
            event: 'realtime.outbox.actor_missing',
            fields: { operation: 'appendSessionRevoked' },
          },
        ],
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
