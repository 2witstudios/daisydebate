import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { type RoundProjection } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createDatabase } from '../src';
import {
  oneOnOneDefinition,
  practiceRoomConfig,
} from '../src/reference-formats';
import { validConfig, validRules } from './round-fixtures';
import { withFixture } from './constraint-helpers';

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);
const instant = '2026-10-07T12:00:00.000Z';

const checkpoint = {
  version: 1 as const,
  prep_consumed_ms: { affirmative: 0, negative: 0 },
  active_prep: null,
  floor: null,
};

test('two ranked rooms may pin the same approved preset', async () => {
  await withFixture(url, async (fixture) => {
    const formatId = await fixture.format();
    await fixture.preset(formatId);
    const room = (id: string) => ({
      id,
      format_id: formatId,
      format_version: 1,
      preset_version: 1,
      competition_type: 'ranked',
      length: 'full',
      config: validConfig,
      execution_plan: { preRoundPrep: { enabled: false } },
      rules_snapshot: validRules,
      status: 'assembling',
    });
    const first = createId();
    const second = createId();
    await fixture.insert('rooms', room(first));
    await fixture.insert('rooms', room(second));
    assert({
      given: 'one current preset used by two independent ranked rooms',
      should: 'retain both rooms with their pinned provenance',
      actual: await fixture.count('rooms', 'format_id', formatId),
      expected: 2,
    });
  });
});

test('a room waits for every seat and finishes durable pre-round prep before freezing', async () => {
  await withFixture(url, async (fixture) => {
    const formatId = `fmt-${createId()}`;
    await fixture.insert(
      'format_revisions',
      {
        format_id: formatId,
        version: 1,
        definition: oneOnOneDefinition,
      },
      'format_id',
    );
    await fixture.insert('formats', {
      id: formatId,
      name: 'Prep proof format',
      current_version: 1,
    });
    const prep = { enabled: true as const, durationMs: 60_000 };
    const rules = {
      ...validRules,
      seats: { affirmative: 1, negative: 1, judge: 1 },
      segments: oneOnOneDefinition.segments.map(
        ({ defaultDurationMs, ...segment }) => ({
          ...segment,
          durationMs: defaultDurationMs,
        }),
      ),
    };
    const roomId = createId();
    const roundId = createId();
    fixture.track('rooms', roomId);
    fixture.track('rounds', roundId);
    const database = createDatabase({ url, nextActorId: createId });
    try {
      await database.createRoom({
        id: roomId,
        formatId,
        formatVersion: 1,
        presetVersion: null,
        competitionType: 'practice',
        length: 'full',
        config: { ...practiceRoomConfig, preRoundPrep: prep },
        executionPlan: { preRoundPrep: prep },
        rules,
      });
      for (const [role, slot] of [
        ['affirmative', 0],
        ['negative', 0],
        ['judge', 0],
      ] as const) {
        const participantId = createId();
        fixture.track('room_participants', participantId);
        fixture.track('round_participants', participantId);
        await database.seatRoomParticipant({
          roomId,
          participantId,
          actorId: await fixture.actor(),
          role,
          slot,
        });
        const [row] = (await fixture.sql.unsafe(
          'select status from rooms where id = $1',
          [roomId],
        )) as Array<{ status: string }>;
        assert({
          given: `${role} joined the room`,
          should: 'mark ready only once every declared seat is held',
          actual: row?.status,
          expected: role === 'judge' ? 'ready' : 'assembling',
        });
      }
      await assertRejects({
        given: 'a complete cast before pre-round prep starts',
        should: 'refuse to freeze a round',
        actual: () =>
          database.startRound({
            roomId,
            roundId,
            resolution: 'A test resolution',
          }),
        code: 'CONFLICT',
      });
      await database.startRoomPrep(roomId);
      await assertRejects({
        given: 'the same pre-round prep start replayed',
        should: 'leave its original database clock anchor intact',
        actual: () => database.startRoomPrep(roomId),
        code: 'CONFLICT',
      });
      await assertRejects({
        given: 'prep anchored on the database clock but still running',
        should: 'refuse to freeze a round',
        actual: () =>
          database.startRound({
            roomId,
            roundId,
            resolution: 'A test resolution',
          }),
        code: 'CONFLICT',
      });
      await fixture.sql.unsafe(
        "update rooms set prep_started_at = statement_timestamp() - interval '61 seconds' where id = $1",
        [roomId],
      );
      await database.startRound({
        roomId,
        roundId,
        resolution: 'A test resolution',
      });
      assert({
        given: 'all seats held and the stored prep anchor expired',
        should: 'freeze exactly one scheduled round with the pinned rules',
        actual: await fixture.count('rounds', 'id', roundId),
        expected: 1,
      });
    } finally {
      await database.close();
    }
  });
});

test('one write closes a speech and opens the next under the one-open-row index', async () => {
  await withFixture(url, async (fixture) => {
    const roundId = await fixture.round({
      status: 'active',
      current_stage: 'live',
      started_at: new Date(instant),
    });
    const oldId = createId();
    await fixture.insert('round_segments', {
      id: oldId,
      round_id: roundId,
      sequence: 0,
      type: 'speech',
      rules_segment_key: 'AC',
      started_at: new Date(instant),
      duration_ms: 240_000,
    });
    const nextId = createId();
    const projection: RoundProjection = {
      round: {
        status: 'active',
        currentStage: 'live',
        startedAt: instant,
        completedAt: null,
        outcome: null,
        checkpoint,
      },
      segmentCloses: [{ id: oldId, endedAt: instant }],
      segmentInserts: [
        {
          id: nextId,
          sequence: 1,
          type: 'speech',
          rulesSegmentKey: 'NC',
          startedAt: instant,
          durationMs: 240_000,
        },
      ],
      effects: [],
    };
    const database = createDatabase({ url, nextActorId: createId });
    try {
      await database.applyRoundExecution({
        roundId,
        expectedVersion: 1,
        command: null,
        projection,
      });
      const rows = (await fixture.sql.unsafe(
        'select id, ended_at from round_segments where round_id = $1 order by sequence',
        [roundId],
      )) as Array<{ id: string; ended_at: Date | null }>;
      assert({
        given: 'a segment transition in one versioned execution',
        should: 'close the old interval and leave only its successor open',
        actual: rows.map((row) => [row.id, row.ended_at === null]),
        expected: [
          [oldId, false],
          [nextId, true],
        ],
      });
    } finally {
      await database.close();
    }
  });
});

test('hydration orders closed segments by their schedule sequence', async () => {
  await withFixture(url, async (fixture) => {
    const roundId = await fixture.round();
    for (const sequence of [1, 0]) {
      await fixture.insert('round_segments', {
        id: createId(),
        round_id: roundId,
        sequence,
        type: 'speech',
        rules_segment_key: sequence === 0 ? 'AC' : 'NC',
        started_at: new Date(instant),
        ended_at: new Date(instant),
        duration_ms: 240_000,
      });
    }
    const database = createDatabase({ url, nextActorId: createId });
    try {
      const round = await database.getRound(roundId);
      assert({
        given: 'closed segments inserted in reverse schedule order',
        should:
          'hydrate in ascending sequence for runtime and prompt consumers',
        actual: round?.segments.map((segment) => segment.sequence),
        expected: [0, 1],
      });
    } finally {
      await database.close();
    }
  });
});
