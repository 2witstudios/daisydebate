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
        id: '5b0f0000-0000-4000-8000-000000000002',
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
      actual: await database.getDebate('5b0f0000-0000-4000-8000-000000000001'),
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
        snapshot: { resolution: 'revised' },
        updatedAt: record.updatedAt,
      }),
      expected: null,
    });
  });

  test('returns the advanced record when the expected version matches', async () => {
    const record = sampleDebate();
    const advanced = {
      ...record,
      version: record.version + 1,
      snapshot: { resolution: 'revised' },
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
