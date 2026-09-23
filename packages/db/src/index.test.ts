import { expect } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { getTableName } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { debates } from './schema/debates';
import { users } from './schema/users';
import * as packageEntry from './index';
import { createDatabase } from './index';
import {
  createTestDatabase,
  fakeSqlWithBrokenListen,
  type SinkEvent,
} from './index.test-support';

setupRitewayBun();

/** A database whose server refuses connections, recording sink events. */
const unreachableDatabase = () => {
  const events: SinkEvent[] = [];
  const database = createDatabase({
    url: 'postgresql://user:password@127.0.0.1:1/daisy',
    eventSink: (event, fields, message) =>
      events.push({ event, fields, message }),
    nextActorId: createId,
  });
  return { database, events };
};

describe('package entry surface (ISSUE-8 AC1)', () => {
  test('never re-exports a function that takes a Drizzle transaction/table handle, only the createDatabase factory and value-typed outbox helpers', () => {
    assert({
      given: "the package entry's exported names",
      should:
        'exclude appendOutboxEvent, drainOutbox, purgeExpiredOutboxEvents and the raw outbox table — each takes or is a Drizzle handle, so a caller outside packages/db can only reach the opaque createDatabase() surface',
      actual: Object.keys(packageEntry).sort(),
      expected: [
        'OUTBOX_ORIGIN',
        'createDatabase',
        'decodeOutboxCursor',
        'encodeOutboxCursor',
      ].sort(),
    });
  });
});

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

  test('checkListen reports true after subscribing and unsubscribing', async () => {
    const { database } = createTestDatabase([]);

    assert({
      given: 'a LISTEN that PostgreSQL acknowledges',
      should: 'resolve true and leave no open subscription',
      actual: await database.checkListen(),
      expected: true,
    });
  });

  test('checkListen fails closed when LISTEN is unavailable', async () => {
    const { client } = fakeSqlWithBrokenListen([]);
    const events: SinkEvent[] = [];
    const database = createDatabase({
      url: 'postgresql://unit:unit@127.0.0.1:1/unit',
      eventSink: (event, fields, message) =>
        events.push({ event, fields, message }),
      client,
      nextActorId: createId,
    });

    await expect(database.checkListen()).rejects.toThrow('listen unavailable');
    assert({
      given: 'a broken LISTEN connection',
      should: 'report the failure through the event sink',
      actual: events.map((event) => event.fields.operation),
      expected: ['checkListen'],
    });
  });
});

describe('session revocation', () => {
  const actorId = 'z9y8x7w6v5u4t3s2r1q0p9o8';

  test('revokes every other session for the user in one atomic statement, resolving the actor and appending session.revoked in the same transaction', async () => {
    const userId = 'a7b3c9d1e5f2k4m6n8p1r3t5';
    const { database, queries } = createTestDatabase([
      [['session-row-id']],
      [[actorId]],
      [['5', '10']],
      [],
    ]);

    const removed = await database.revokeOtherSessions(userId, 'keep-me');

    const lower = (index: number) => queries[index]?.query.toLowerCase() ?? '';
    const selectsActor =
      lower(1).includes('select') && lower(1).includes('actors');
    const insertsOutbox =
      lower(2).includes('insert into') && lower(2).includes('outbox');

    assert({
      given: "a user's other sessions and the token to keep",
      should:
        'issue the DELETE first with no prior listing query, resolve the actor, then append the outbox row and NOTIFY in the same transaction',
      actual: {
        removed,
        queryCount: queries.length,
        deletesSession: lower(0).includes('delete'),
        mentionsUserId: queries[0]?.query.includes('user_id'),
        mentionsToken: queries[0]?.query.includes('token'),
        params: queries[0]?.params,
        selectsActor,
        insertsOutbox,
        notifies: lower(3).includes('pg_notify'),
      },
      expected: {
        removed: 1,
        queryCount: 4,
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

  test('revokes sessions but appends nothing and reports a registered event when the user has no actor row (never claimed a username)', async () => {
    const userId = 'a7b3c9d1e5f2k4m6n8p1r3t5';
    const events: SinkEvent[] = [];
    const { database, queries } = createTestDatabase(
      [[['session-row-id']], []],
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
        queryCount: 2,
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
