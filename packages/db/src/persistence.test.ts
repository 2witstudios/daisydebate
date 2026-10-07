import { expect } from 'bun:test';
import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createTestDatabase, roundRow, validRules } from './index.test-support';
import { emptyRuntimeCheckpoint } from '@daisy/protocol';

setupRitewayBun();

const rules = validRules;
const checkpoint = emptyRuntimeCheckpoint;
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
      competitionType: 'practice',
      length: 'full',
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
        competitionType: 'practice',
        length: 'full',
        formatId: 'foundation',
        formatVersion: 1,
        presetVersion: null,
        rules,
      }),
    ).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  test('getRound hydrates the durable truth: rules, checkpoint, seats, rows', async () => {
    const row = roundRow({
      id: 'c8d4e2f6a1b3k5m7n9p2r4t6',
      roomId: null,
      createdByActorId: null,
      resolution: 'A representative resolution',
      competitionType: 'practice',
      length: 'full',
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
    const { database, queries } = createTestDatabase([[], [row], [], []]);
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

  test('applyRoundExecution writes the command, the segments and the round row as one versioned step', async () => {
    const { database, queries } = createTestDatabase([
      [], // command idempotency select
      [[3]], // rounds select for update (positional: the for-update path)
      [], // the round-row update
      [], // the command insert
      [[9]], // the refusing run's rounds select for update: stored 9, expected 4
    ]);
    await database.applyRoundExecution({
      roundId: 'c8d4e2f6a1b3k5m7n9p2r4t6',
      expectedVersion: 3,
      command: {
        commandId: 'd0e1f2a3b4c5d6e7f8a9b0c1',
        actorId: 'k2v9x0f4m8q3w1z7c5n6b4d2',
        serviceId: null,
        type: 'start',
        payloadDigest: 'a'.repeat(64),
        result: { ok: true },
      },
      projection: {
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
      },
    });
    assert({
      given: 'a start execution at the expected version',
      should: 'check the command id, lock the round and write both rows',
      actual: [
        queries[0]?.query.includes('"round_commands"'),
        queries[1]?.query.includes('for update'),
        queries[3]?.query.includes('insert into "round_commands"'),
      ],
      expected: [true, true, true],
    });
    await assertRejects({
      given: 'an execution against a round that moved on',
      should: 'refuse with a conflict and write nothing',
      actual: () =>
        database.applyRoundExecution({
          roundId: 'c8d4e2f6a1b3k5m7n9p2r4t6',
          expectedVersion: 4,
          command: null,
          projection: {
            round: null,
            segmentInserts: [],
            segmentCloses: [],
            effects: [],
          },
        }),
      code: 'CONFLICT',
    });
  });
});
