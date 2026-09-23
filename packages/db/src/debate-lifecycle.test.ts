import { expect } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  createTestDatabase,
  debateRow,
  sampleDebate,
  sampleSnapshot,
} from './index.test-support';

setupRitewayBun();

describe('database debate lifecycle projections', () => {
  test('binds mode, visibility and the snapshot phase on create', async () => {
    const record = sampleDebate();
    const { database, queries } = createTestDatabase([[debateRow(record)]]);

    const created = await database.createDebate({
      id: record.id,
      resolution: record.resolution,
      format: record.format,
      snapshot: record.snapshot,
      mode: record.mode,
      visibility: record.visibility,
    });

    assert({
      given:
        'a debate created with a mode, a visibility and a waiting snapshot',
      should:
        'bind all three as insert parameters and expose them on the record',
      actual: {
        bound: ['casual', 'unlisted', 'waiting'].map((value) =>
          queries[0]?.params.includes(value),
        ),
        exposed: [created.mode, created.visibility, created.phase],
      },
      expected: {
        bound: [true, true, true],
        exposed: ['casual', 'unlisted', 'waiting'],
      },
    });
  });

  test('refuses to create a debate whose snapshot has no valid phase', async () => {
    const record = sampleDebate();
    const { database, queries } = createTestDatabase([[debateRow(record)]]);

    await expect(
      database.createDebate({
        id: record.id,
        resolution: record.resolution,
        format: record.format,
        snapshot: { ...sampleSnapshot(), phase: 'paused' },
        mode: record.mode,
        visibility: record.visibility,
      }),
    ).rejects.toThrow('Invalid debate snapshot');

    assert({
      given: 'a snapshot with a phase outside the protocol vocabulary',
      should: 'reject before any statement reaches the database',
      actual: queries.length,
      expected: 0,
    });
  });

  test('writes the phase projection in the same UPDATE as the snapshot', async () => {
    const record = sampleDebate();
    const active = {
      ...record,
      version: 2,
      snapshot: sampleSnapshot({ phase: 'active' }),
      phase: 'active' as const,
      startedAt: record.updatedAt,
    };
    const { database, queries } = createTestDatabase([[debateRow(active)]]);

    const saved = await database.saveSnapshot({
      id: record.id,
      expectedVersion: record.version,
      snapshot: active.snapshot,
      updatedAt: record.updatedAt,
    });

    assert({
      given: 'a snapshot save that moves the debate to active',
      should:
        'issue one UPDATE that sets snapshot, phase and started_at together, then project the seats',
      actual: {
        statements: queries.map(({ query }) => query.split(' ')[0]),
        setsPhaseAndStart:
          queries[0]?.query.includes('"phase" = ') === true &&
          queries[0]?.query.includes('"started_at" = ') === true,
        phaseBound: queries[0]?.params.includes('active'),
        record: [saved?.phase, saved?.startedAt],
      },
      expected: {
        statements: ['update', 'delete'],
        setsPhaseAndStart: true,
        phaseBound: true,
        record: ['active', record.updatedAt],
      },
    });
  });

  test('requires an outcome to complete and writes it with completed_at', async () => {
    const record = sampleDebate();
    const { database, queries } = createTestDatabase([[]]);

    await expect(
      database.saveSnapshot({
        id: record.id,
        expectedVersion: record.version,
        snapshot: sampleSnapshot({ phase: 'completed' }),
        updatedAt: record.updatedAt,
      }),
    ).rejects.toThrow('outcome');

    await database.saveSnapshot({
      id: record.id,
      expectedVersion: record.version,
      snapshot: sampleSnapshot({ phase: 'completed' }),
      updatedAt: record.updatedAt,
      outcome: 'affirmative',
    });

    assert({
      given: 'a completing save without and then with an outcome',
      should:
        'reject the first before any statement and bind outcome and completed_at on the second',
      actual: {
        statements: queries.length,
        setsCompletion:
          queries[0]?.query.includes('"completed_at" = ') === true &&
          queries[0]?.query.includes('"outcome" = ') === true,
        outcomeBound: queries[0]?.params.includes('affirmative'),
      },
      expected: { statements: 1, setsCompletion: true, outcomeBound: true },
    });
  });

  test('leaves started_at untouched when a debate completes', async () => {
    const record = sampleDebate();
    const { database, queries } = createTestDatabase([[]]);

    await database.saveSnapshot({
      id: record.id,
      expectedVersion: record.version,
      snapshot: sampleSnapshot({ phase: 'completed' }),
      updatedAt: record.updatedAt,
      outcome: 'abandoned',
    });

    assert({
      given: 'a debate abandoned straight from waiting',
      should:
        'complete without fabricating a start time, so the CHECK decides whether a never-started completion is legal',
      actual: {
        // The RETURNING clause lists every column; only the SET clause matters.
        setsStartedAt: queries[0]?.query.includes('"started_at" = '),
        setsCompletion:
          queries[0]?.query.includes('"completed_at" = ') === true &&
          queries[0]?.params.includes('abandoned'),
      },
      expected: { setsStartedAt: false, setsCompletion: true },
    });
  });

  test('refuses an outcome on a snapshot that is not completed', async () => {
    const record = sampleDebate();
    const { database, queries } = createTestDatabase([[]]);

    await expect(
      database.saveSnapshot({
        id: record.id,
        expectedVersion: record.version,
        snapshot: sampleSnapshot({ phase: 'active' }),
        updatedAt: record.updatedAt,
        outcome: 'draw',
      }),
    ).rejects.toThrow('outcome');

    assert({
      given: 'an active snapshot saved with an outcome',
      should: 'reject before any statement instead of silently dropping it',
      actual: queries.length,
      expected: 0,
    });
  });
});
