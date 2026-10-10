import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { buildDebateTopic } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createDatabase } from '../src';
import { practiceRoomConfig } from '../src/reference-formats';
import { validRules } from './round-fixtures';
import {
  createScheduledRound,
  roundAuthoring,
  withFixture,
} from './constraint-helpers';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);
const instant = '2026-10-09T12:00:00.000Z';

test('Room freeze appends the scheduled Round phase signal in its transaction', async () => {
  await withFixture(url, async (fixture) => {
    const formatId = await fixture.format();
    const roomId = createId();
    const roundId = createId();
    const hostActorId = await fixture.actor();
    fixture.track('rooms', roomId);
    fixture.track('rounds', roundId);
    await fixture.insert('rooms', {
      id: roomId,
      host_actor_id: hostActorId,
      title: 'Phase event proof',
      topic: 'A motion',
      visibility: 'public',
      format_id: formatId,
      format_version: 1,
      preset_version: null,
      competition_type: 'casual',
      length: 'full',
      config: practiceRoomConfig,
      execution_plan: { preRoundPrep: { enabled: false } },
      rules_snapshot: validRules,
      status: 'ready',
    });
    const seats = [
      ['affirmative', 0],
      ['negative', 0],
    ] as const;
    for (const [role, slot] of seats) {
      await fixture.insert('room_participants', {
        id: createId(),
        room_id: roomId,
        actor_id: await fixture.actor(),
        role,
        slot,
      });
    }
    const database = createDatabase({ url, nextActorId: createId });
    try {
      await database.startRound({ roomId, roundId, resolution: 'A motion' });
      const rows = (await fixture.sql.unsafe(
        'select topic, kind, version, payload from outbox where topic = $1 order by seq',
        [buildDebateTopic(roundId)],
      )) as Array<{
        topic: string;
        kind: string;
        version: number;
        payload: { kind: string; ids: string[]; entityVersion: number };
      }>;
      assert({
        given: 'a complete Room frozen through the durable writer',
        should:
          'commit one canonical phase doorbell for the created scheduled Round',
        actual: rows,
        expected: [
          {
            topic: buildDebateTopic(roundId),
            kind: 'debate.phase-changed',
            version: 1,
            payload: {
              kind: 'debate.phase-changed',
              ids: [roundId],
              entityVersion: 1,
            },
          },
        ],
      });
    } finally {
      await database.close();
    }
  });
});

test('accepted Round projections append one phase signal with the stored version', async () => {
  await withFixture(url, async (fixture) => {
    const authoring = await roundAuthoring(fixture, url);
    const { roundId, database } = authoring;
    try {
      await createScheduledRound(authoring, 'A motion');
      const before = await database.getRound(roundId);
      if (!before) throw new Error('the scheduled Round did not hydrate');
      await database.applyRoundExecution({
        roundId,
        expectedVersion: before.version,
        command: null,
        projection: {
          round: {
            status: 'active',
            currentStage: 'countdown',
            startedAt: instant,
            completedAt: null,
            outcome: null,
            checkpoint: before.checkpoint,
          },
          segmentInserts: [],
          segmentCloses: [],
          effects: [],
        },
      });
      const rows = (await fixture.sql.unsafe(
        'select kind, version, payload from outbox where topic = $1 order by seq',
        [buildDebateTopic(roundId)],
      )) as Array<{
        kind: string;
        version: number;
        payload: { kind: string; ids: string[]; entityVersion: number };
      }>;
      assert({
        given: 'an accepted scheduled-to-active persisted Round transition',
        should: 'append one content-free event for the committed revision',
        actual: rows,
        expected: [
          {
            kind: 'debate.phase-changed',
            version: 1,
            payload: {
              kind: 'debate.phase-changed',
              ids: [roundId],
              entityVersion: before.version + 1,
            },
          },
        ],
      });
    } finally {
      await database.close();
    }
  });
});
