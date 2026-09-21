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
