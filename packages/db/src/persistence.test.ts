import { expect } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  createTestDatabase,
  debateRow,
  sampleDebate,
  sampleUser,
  userRow,
  type SinkEvent,
} from './index.test-support';

setupRitewayBun();

const withSink = () => {
  const events: SinkEvent[] = [];
  return { events };
};

describe('database user persistence', () => {
  test('returns the stored user record after insert', async () => {
    const record = sampleUser();
    const { database } = createTestDatabase([[userRow(record)]]);

    assert({
      given: 'a user insert accepted by the database',
      should: 'return the stored record including defaults',
      actual: await database.createUser({
        id: record.id,
        username: record.username,
      }),
      expected: record,
    });
  });

  test('rejects and reports a user insert that returns no row', async () => {
    const { events } = withSink();
    const { database } = createTestDatabase([[]], events);

    await expect(
      database.createUser({
        id: 'a7b3c9d1e5f2k4m6n8p1r3t5',
        username: 'demo',
      }),
    ).rejects.toThrow('User insert returned no row');

    assert({
      given: 'a user insert that silently returns nothing',
      should: 'report the failed user creation operation',
      actual: events,
      expected: [
        {
          event: 'db.query.failed',
          fields: { operation: 'createUser' },
          message: 'Database query failed',
        },
      ],
    });
  });
});

describe('database debate persistence', () => {
  test('stores an absent author as an explicit null', async () => {
    const record = sampleDebate();
    const { database, queries } = createTestDatabase([[debateRow(record)]]);

    await database.createDebate({
      id: record.id,
      resolution: record.resolution,
      format: record.format,
      snapshot: record.snapshot,
      mode: record.mode,
      visibility: record.visibility,
    });

    assert({
      given: 'a debate created without an author',
      should: 'bind the author column to an explicit null parameter',
      actual: queries[0]?.params.includes(null),
      expected: true,
    });
  });

  test('returns the stored debate snapshot from the insert transaction', async () => {
    const record = sampleDebate();
    const { database } = createTestDatabase([[debateRow(record)]]);

    assert({
      given: 'a debate insert accepted inside its transaction',
      should: 'return the stored record',
      actual: await database.createDebate({
        id: record.id,
        createdBy: record.createdBy,
        resolution: record.resolution,
        format: record.format,
        snapshot: record.snapshot,
        mode: record.mode,
        visibility: record.visibility,
      }),
      expected: record,
    });
  });

  test('rejects and reports a debate insert that returns no row', async () => {
    const { events } = withSink();
    const { database } = createTestDatabase([[]], events);
    const record = sampleDebate();

    await expect(
      database.createDebate({
        id: record.id,
        resolution: record.resolution,
        format: record.format,
        snapshot: record.snapshot,
        mode: record.mode,
        visibility: record.visibility,
      }),
    ).rejects.toThrow('Debate insert returned no row');

    assert({
      given: 'a debate insert that silently returns nothing',
      should: 'report the failed debate creation operation',
      actual: events,
      expected: [
        {
          event: 'db.query.failed',
          fields: { operation: 'createDebate' },
          message: 'Database query failed',
        },
      ],
    });
  });

  test('returns null instead of a record when the debate is absent', async () => {
    const { database } = createTestDatabase([[]]);

    assert({
      given: 'an id matching no stored debate',
      should: 'resolve to null',
      actual: await database.getDebate('k2v9x0f4m8q3w1z7c5n6b4d2'),
      expected: null,
    });
  });

  test('returns the stored debate when the id matches', async () => {
    const record = sampleDebate();
    const { database } = createTestDatabase([[debateRow(record)]]);

    assert({
      given: 'an id matching a stored debate',
      should: 'return the full durable record',
      actual: await database.getDebate(record.id),
      expected: record,
    });
  });
});

describe('database optimistic snapshot saves', () => {
  test('returns null when the expected version no longer matches', async () => {
    const record = sampleDebate();
    const { database } = createTestDatabase([[]]);

    assert({
      given: 'a snapshot save whose expected version was concurrently advanced',
      should: 'report a null outcome instead of a record',
      actual: await database.saveSnapshot({
        id: record.id,
        expectedVersion: record.version,
        snapshot: { phase: 'waiting', resolution: 'revised' },
        updatedAt: record.updatedAt,
      }),
      expected: null,
    });
  });

  test('returns debate timestamps as the UTC instant the driver returned', async () => {
    // Bun SQL yields timestamptz as Date; the record must not relabel that
    // instant with the host offset (TZ=America/Chicago once produced -06).
    const record = sampleDebate();
    const { database } = createTestDatabase([[debateRow(record)]]);
    const loaded = await database.getDebate(record.id);

    assert({
      given: 'a debate row whose driver timestamps are Date values',
      should: 'expose UTC ISO strings for the same instant in any timezone',
      actual: [loaded?.createdAt, loaded?.updatedAt],
      expected: ['2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'],
    });
  });

  test('returns the advanced record when the expected version matches', async () => {
    const record = sampleDebate();
    const advanced = {
      ...record,
      version: record.version + 1,
      snapshot: { phase: 'waiting', resolution: 'revised' },
    };
    const { database } = createTestDatabase([[debateRow(advanced)]]);

    assert({
      given: 'a snapshot save whose expected version still matches',
      should: 'return the record at its advanced version',
      actual: await database.saveSnapshot({
        id: record.id,
        expectedVersion: record.version,
        snapshot: advanced.snapshot,
        updatedAt: record.updatedAt,
      }),
      expected: advanced,
    });
  });

  test('reports driver failures through the injected sink', async () => {
    const { events } = withSink();
    const { database } = createTestDatabase(
      [new Error('connection closed')],
      events,
    );
    const record = sampleDebate();

    const caught = await database
      .saveSnapshot({
        id: record.id,
        expectedVersion: record.version,
        snapshot: record.snapshot,
        updatedAt: record.updatedAt,
      })
      .then(
        () => 'resolved',
        (error: unknown) => (error instanceof Error ? 'error' : 'other'),
      );

    assert({
      given: 'a snapshot save rejected by the driver',
      should: 'surface the failure as an error',
      actual: caught,
      expected: 'error',
    });
    assert({
      given: 'a snapshot save rejected by the driver',
      should: 'report the failed snapshot operation',
      actual: events,
      expected: [
        {
          event: 'db.query.failed',
          fields: { operation: 'saveSnapshot' },
          message: 'Database query failed',
        },
      ],
    });
  });
});

describe('claimUsername', () => {
  const claim = { userId: 'a7b3c9d1e5f2k4m6n8p1r3t5', username: 'ada' };

  test('claims a name for a user that has none', async () => {
    const { database, queries } = createTestDatabase([
      [['a7b3c9d1e5f2k4m6n8p1r3t5']],
    ]);
    assert({
      given: 'an update that matched the username-less user',
      should: 'report claimed, guarded by username IS NULL',
      actual: [
        (await database.claimUsername(claim)).kind,
        queries[0]?.query.includes('"username" is null'),
      ],
      expected: ['claimed', true],
    });
  });

  test('reports an owner retry as unchanged and a different name as already set', async () => {
    const same = createTestDatabase([[], [['ADA']]]);
    const other = createTestDatabase([[], [['grace']]]);
    assert({
      given: 'no row updated and a stored name equal, or not, to the request',
      should: 'answer unchanged for the same name and already-set otherwise',
      actual: [
        (await same.database.claimUsername(claim)).kind,
        (await other.database.claimUsername(claim)).kind,
      ],
      expected: ['unchanged', 'already-set'],
    });
  });

  test('reports an unknown user and a unique violation', async () => {
    const missing = createTestDatabase([[], []]);
    const conflict = createTestDatabase([
      Object.assign(new Error('duplicate'), { code: '23505' }),
    ]);
    // The shape Bun SQL really produces: drizzle wraps a PostgresError whose
    // SQLSTATE is `errno` and whose `code` is a driver constant.
    const wrapped = createTestDatabase([
      Object.assign(new Error('Failed query'), {
        cause: Object.assign(new Error('duplicate'), {
          code: 'ERR_POSTGRES_SERVER_ERROR',
          errno: '23505',
        }),
      }),
    ]);
    assert({
      given: 'a missing user and unique violations, bare and wrapped',
      should: 'answer unknown-user and taken',
      actual: [
        (await missing.database.claimUsername(claim)).kind,
        (await conflict.database.claimUsername(claim)).kind,
        (await wrapped.database.claimUsername(claim)).kind,
      ],
      expected: ['unknown-user', 'taken', 'taken'],
    });
  });

  test('rethrows and reports any other failure', async () => {
    const events: SinkEvent[] = [];
    const { database } = createTestDatabase([new Error('boom')], events);
    await expect(database.claimUsername(claim)).rejects.toThrow('Failed query');
    assert({
      given: 'a non-uniqueness database failure',
      should: 'report the failed operation',
      actual: events.map((event) => event.fields),
      expected: [{ operation: 'claimUsername' }],
    });
  });
});
