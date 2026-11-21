import { expect } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { getTableColumns, getTableName } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { rounds } from './schema/rounds';
import { users } from './schema/users';
import * as packageEntry from './index';
import * as outboxEntry from '@daisy/db/outbox';
import { unreachableDatabase } from './index.test-support';

setupRitewayBun();

describe('package entry surface (ISSUE-8 AC1)', () => {
  test('never re-exports a function that takes a Drizzle transaction/table handle, only the createDatabase factory and the two startup gates; the capacity-refusal identity is the client-safe @daisy/db/capacity subpath', () => {
    assert({
      given: "the package entry's exported names",
      should:
        'exclude appendOutboxEvent, drainOutbox, deleteExpiredBatch and the raw outbox table — each takes or is a Drizzle handle, so a caller outside packages/db can only reach the opaque createDatabase() surface',
      actual: Object.keys(packageEntry).sort(),
      expected: [
        'WORKLOAD_PROFILES',
        'createDatabase',
        'createRealtimeDatabase',
        'refuseSchemaAlteringRole',
        'refuseUnisolatedTenantTables',
      ].sort(),
    });
  });
});

describe('outbox public surface', () => {
  test('exposes cursor values without raw persistence operations', () => {
    assert({
      given: 'the explicit outbox subpath',
      should: 'expose only portable cursor helpers and the origin',
      actual: Object.keys(outboxEntry).sort(),
      expected: ['OUTBOX_ORIGIN', 'decodeOutboxCursor', 'encodeOutboxCursor'],
    });
  });
});

describe('persistence schema', () => {
  test('tables have independent ownership', () => {
    assert({
      given: 'the durable debate and user tables',
      should: 'map to independent PostgreSQL tables',
      actual: [getTableName(rounds), getTableName(users)],
      expected: ['rounds', 'users'],
    });
  });

  test('supports provisional authentication profiles', () => {
    const columns = getTableColumns(users);

    assert({
      given: 'verified users before username onboarding',
      should:
        'retain identity fields while allowing only the username to remain provisional',
      actual: {
        hasEmail: 'email' in columns,
        hasEmailVerified: 'emailVerified' in columns,
        hasName: 'name' in columns,
        hasImage: 'image' in columns,
        usernameRequired: columns.username.notNull,
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

describe('database adapter failures', () => {
  test('reports a failed query through the injected event sink', async () => {
    const { database, events } = unreachableDatabase();

    await expect(database.health()).rejects.toMatchObject({
      cause: { code: 'ERR_POSTGRES_CONNECTION_REFUSED' },
    });

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
