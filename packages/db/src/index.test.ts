import { expect } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { getTableName } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { debates } from './schema/debates';
import { users } from './schema/users';
import { createDatabase } from './index';
import { createTestDatabase } from './index.test-support';

setupRitewayBun();

describe('persistence schema', () => {
  test('tables have independent ownership', () => {
    assert({
      given: 'the durable debate and user tables',
      should: 'map to independent PostgreSQL tables',
      actual: [getTableName(debates), getTableName(users)],
      expected: ['debates', 'users'],
    });
  });

  test('supports provisional authentication profiles', () => {
    const columns = users as unknown as Record<string, { notNull?: boolean }>;

    assert({
      given: 'verified users before username onboarding',
      should:
        'retain identity fields while allowing only the username to remain provisional',
      actual: {
        hasEmail: 'email' in columns,
        hasEmailVerified: 'emailVerified' in columns,
        hasName: 'name' in columns,
        hasImage: 'image' in columns,
        usernameRequired: columns.username?.notNull,
      },
      expected: {
        hasEmail: true,
        hasEmailVerified: true,
        hasName: true,
        hasImage: true,
        usernameRequired: false,
      },
    });
  });

  test('reads user timestamps as the instant the driver returned', () => {
    // Bun SQL returns timestamptz as Date. Better Auth models these fields as
    // Date, and a string-mode column would relabel the UTC wall time with the
    // process's local offset before the auth adapter re-parses it.
    const stored = new Date('2026-01-01T00:00:00.000Z');

    assert({
      given: 'user timestamps shared with the Better Auth adapter',
      should: 'pass the driver Date through unchanged in any process timezone',
      actual: [users.createdAt, users.updatedAt].map((column) =>
        column.mapFromDriverValue(stored as never),
      ),
      expected: [stored, stored],
    });
  });

  test('declares case-folded username uniqueness', () => {
    const config = getTableConfig(users);

    assert({
      given: 'historical usernames that must keep their spelling',
      should: 'enforce uniqueness on their case-folded values',
      actual: config.indexes.some(
        (index) => index.config.name === 'users_username_lower_unique',
      ),
      expected: true,
    });
  });
});

describe('database health', () => {
  test('reports healthy after a successful round trip', async () => {
    const { database } = createTestDatabase([[]]);

    assert({
      given: 'a database answering a round-trip query',
      should: 'report health',
      actual: await database.health(),
      expected: true,
    });
  });
});

describe('session revocation', () => {
  test('revokes every other session for the user in one atomic statement, appending session.revoked in the same transaction', async () => {
    const userId = 'a7b3c9d1e5f2k4m6n8p1r3t5';
    const { database, queries } = createTestDatabase([
      [['session-row-id']],
      [{ seq: '5', txid: '10' }],
      [],
    ]);

    const removed = await database.revokeOtherSessions(userId, 'keep-me');

    assert({
      given: "a user's other sessions and the token to keep",
      should:
        'issue the DELETE first with no prior listing query, then append the outbox row and NOTIFY in the same transaction',
      actual: {
        removed,
        queryCount: queries.length,
        deletesSession: queries[0]?.query.toLowerCase().includes('delete'),
        mentionsUserId: queries[0]?.query.includes('user_id'),
        mentionsToken: queries[0]?.query.includes('token'),
        params: queries[0]?.params,
        insertsOutbox:
          queries[1]?.query.toLowerCase().includes('insert into') &&
          queries[1]?.query.toLowerCase().includes('outbox'),
        notifies: queries[2]?.query.toLowerCase().includes('pg_notify'),
      },
      expected: {
        removed: 1,
        queryCount: 3,
        deletesSession: true,
        mentionsUserId: true,
        mentionsToken: true,
        params: [userId, 'keep-me'],
        insertsOutbox: true,
        notifies: true,
      },
    });
  });

  test('appends no outbox row when there is nothing to revoke', async () => {
    const userId = 'a7b3c9d1e5f2k4m6n8p1r3t5';
    const { database, queries } = createTestDatabase([[]]);

    const removed = await database.revokeOtherSessions(userId, 'keep-me');

    assert({
      given: 'a user with no other sessions to revoke',
      should: 'issue only the DELETE, appending nothing to the outbox',
      actual: { removed, queryCount: queries.length },
      expected: { removed: 0, queryCount: 1 },
    });
  });

  test('reports a failed revocation through the injected event sink', async () => {
    const events: Array<{
      event: string;
      fields: Record<string, unknown>;
      message: string;
    }> = [];
    const database = createDatabase({
      url: 'postgresql://user:password@127.0.0.1:1/daisy',
      eventSink: (event, fields, message) =>
        events.push({ event, fields, message }),
    });

    await expect(
      database.revokeOtherSessions('user-1', 'keep-me'),
    ).rejects.toThrow();

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

describe('database adapter failures', () => {
  test('reports a failed query through the injected event sink', async () => {
    const events: Array<{
      event: string;
      fields: Record<string, unknown>;
      message: string;
    }> = [];
    const database = createDatabase({
      url: 'postgresql://user:password@127.0.0.1:1/daisy',
      eventSink: (event, fields, message) =>
        events.push({ event, fields, message }),
    });

    await expect(database.health()).rejects.toThrow();

    assert({
      given: 'a database query that fails',
      should: 'emit the database query failure event with the operation name',
      actual: events,
      expected: [
        {
          event: 'db.query.failed',
          fields: { operation: 'health' },
          message: 'Database query failed',
        },
      ],
    });
  });
});
