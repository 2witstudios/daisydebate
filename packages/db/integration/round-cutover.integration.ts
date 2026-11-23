import { createRoundStore } from '../src/stores/rounds';
import { openDatabaseResources } from '../src/resources';
import { hostWaits } from '@daisy/worker/host';
import { roundDecisionReleasePolicy } from '@daisy/protocol/round-decision-release';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { type RoundProjection } from '@daisy/protocol/runtime';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { validConfig, validRules } from './round-fixtures';
import { withFixture } from './constraint-helpers';
/** This file's database: the area stores it reads, over one set of resources. */
const openStores = (
  options: Parameters<typeof openDatabaseResources>[0] & {
    readonly roundTime?: NonNullable<
      Parameters<typeof createRoundStore>[1]
    >['roundTime'];
    readonly decisionRelease?: NonNullable<
      Parameters<typeof createRoundStore>[1]
    >['decisionRelease'];
  },
) => {
  const resources = openDatabaseResources(options);
  return {
    ...createRoundStore(resources, {
      roundTime: options.roundTime,
      decisionRelease: options.decisionRelease,
    }),
    close: resources.close,
  };
};

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);
const instant = '2026-10-07T12:00:00.000Z';

const checkpoint = {
  version: 1 as const,
  prep_consumed_ms: { affirmative: 0, negative: 0 },
  active_prep: null,
  floor: null,
  incident: { phase: 'none' as const },
  prep_ended_at: null,
  start_gate: null,
  clock_stops: [],
};

test('two ranked rooms may pin the same approved preset', async () => {
  await withFixture(url, async (fixture) => {
    const formatId = await fixture.format();
    await fixture.preset(formatId);
    const hostActorId = await fixture.actor();
    const room = (id: string) => ({
      id,
      host_actor_id: hostActorId,
      title: 'Ranked proof',
      topic: 'A motion',
      visibility: 'public',
      format_id: formatId,
      format_version: 1,
      preset_version: 1,
      competition_type: 'ranked',
      config: validConfig,
      execution_plan: {
        preRoundPrep: { enabled: false },
        resolutionDraw: { enabled: false },
      },
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
    const database = openStores({
      waits: hostWaits,
      decisionRelease: roundDecisionReleasePolicy,
      url,
    });
    try {
      await database.executeRoundTick({
        roundId,
        buildProjection: () => projection,
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
    const database = openStores({
      waits: hostWaits,
      decisionRelease: roundDecisionReleasePolicy,
      url,
    });
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
