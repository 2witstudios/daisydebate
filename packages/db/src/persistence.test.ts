import { expect } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createTestDatabase, roundRow, validRules } from './index.test-support';
import { emptyRuntimeCheckpoint, type RoundProjection } from '@daisy/protocol';

setupRitewayBun();

const rules = validRules;
const checkpoint = emptyRuntimeCheckpoint;
const activeCountdownProjection: RoundProjection = {
  round: {
    status: 'active',
    currentStage: 'countdown',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: null,
    outcome: null,
    checkpoint,
  },
  segmentInserts: [],
  segmentCloses: [],
  effects: [],
};
const isRepeatableReadOnly = (query: string | undefined) => {
  const text = query?.toLowerCase() ?? '';
  return text.includes('repeatable read') && text.includes('read only');
};

describe('round persistence', () => {
  test('createRound inserts the resolved rules and reports conflict on a replayed id', async () => {
    const { database, queries } = createTestDatabase([[], []]);
    await database.createRound({
      id: 'c8d4e2f6a1b3k5m7n9p2r4t6',
      createdByActorId: null,
      resolution: 'A representative resolution',
      competitionType: 'casual',
      formatId: 'foundation',
      formatVersion: 1,
      presetVersion: null,
      rules,
    });
    assert({
      given: 'a service-created round',
      should: 'insert its frozen rules under the foundation format',
      actual: [
        queries[0]?.query.includes('insert into "rounds"'),
        queries[0]?.params.includes('foundation'),
      ],
      expected: [true, true],
    });
    const replayed = createTestDatabase([
      Object.assign(
        new Error(
          'duplicate key value violates unique constraint "rounds_pkey"',
        ),
        { code: '23505' },
      ),
    ]);
    await expect(
      replayed.database.createRound({
        id: 'c8d4e2f6a1b3k5m7n9p2r4t6',
        createdByActorId: null,
        resolution: 'A representative resolution',
        competitionType: 'casual',
        formatId: 'foundation',
        formatVersion: 1,
        presetVersion: null,
        rules,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  test('a Round is read as one revision, even when a write lands between its rows', async () => {
    const at = (version: number) =>
      roundRow({
        id: 'c8d4e2f6a1b3k5m7n9p2r4t6',
        roomId: null,
        createdByActorId: null,
        resolution: 'A representative resolution',
        competitionType: 'casual',
        formatId: 'foundation',
        formatVersion: 1,
        presetVersion: null,
        rules,
        status: 'active',
        currentStage: 'countdown',
        outcome: null,
        ladderId: null,
        startedAt: '2026-01-01T00:00:00.000Z',
        completedAt: null,
        checkpoint,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        version,
      });
    const moved = createTestDatabase([
      [],
      [at(2)],
      [],
      [],
      [[3]],
      [at(3)],
      [],
      [],
      [[3]],
    ]);
    assert({
      given:
        'a projection committed between the Round row and the version read after its child rows',
      should: 'take the read again and return the revision that held still',
      actual: (await moved.database.getRound('c8d4e2f6a1b3k5m7n9p2r4t6'))
        ?.version,
      expected: 3,
    });
    const restless = createTestDatabase([
      [],
      ...[2, 3, 4, 5].flatMap((v) => [[at(v)], [], [], [[v + 1]]]),
    ]);
    await expect(
      restless.database.getRound('c8d4e2f6a1b3k5m7n9p2r4t6'),
    ).rejects.toMatchObject({ code: 'INFRASTRUCTURE' });
  });

  test('getRound hydrates the durable truth: rules, checkpoint, seats, rows', async () => {
    const row = roundRow({
      id: 'c8d4e2f6a1b3k5m7n9p2r4t6',
      roomId: null,
      createdByActorId: null,
      resolution: 'A representative resolution',
      competitionType: 'casual',
      formatId: 'foundation',
      formatVersion: 1,
      presetVersion: null,
      rules,
      status: 'active',
      currentStage: 'countdown',
      outcome: null,
      ladderId: null,
      startedAt: '2026-01-01T00:00:00.000Z',
      completedAt: null,
      checkpoint,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      version: 2,
    });
    const { database, queries } = createTestDatabase([
      [],
      [row],
      [],
      [],
      // The version read again after the rows: unchanged, so the read is one revision.
      [[2]],
    ]);
    const round = await database.getRound('c8d4e2f6a1b3k5m7n9p2r4t6');
    assert({
      given: 'an active round row with no participants or segments',
      should: 'hydrate its frozen rules and empty checkpoint verbatim',
      actual: {
        status: round?.status,
        stage: round?.currentStage,
        rules: round?.rules.version,
        checkpoint: round?.checkpoint.version,
        participants: round?.participants.length,
        segments: round?.segments.length,
        version: round?.version,
      },
      expected: {
        status: 'active',
        stage: 'countdown',
        rules: 2,
        checkpoint: 1,
        participants: 0,
        segments: 0,
        version: 2,
      },
    });
    assert({
      given: 'a Round hydration spanning parent, seats and segments',
      should: 'read them under one repeatable-read, read-only snapshot',
      actual: isRepeatableReadOnly(queries[0]?.query),
      expected: true,
    });
  });
});

test('Round projection callbacks are synchronous pure execution seams', () => {
  type BuildProjection = Parameters<
    ReturnType<typeof createTestDatabase>['database']['executeRoundCommand']
  >[0]['buildProjection'];
  // @ts-expect-error A callback cannot perform asynchronous I/O while holding the transaction.
  const asynchronous: BuildProjection = async () => activeCountdownProjection;
  assert({
    given: 'the public Round execution callback type',
    should: 'exclude async callbacks at compile time',
    actual: typeof asynchronous,
    expected: 'function',
  });
});
