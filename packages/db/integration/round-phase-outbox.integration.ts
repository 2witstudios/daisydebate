import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { buildDebateTopic } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  createScheduledRound,
  roundAuthoring,
  withFixture,
} from './constraint-helpers';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);
const instant = '2026-10-09T12:00:00.000Z';

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
        buildProjection: () => ({
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
        }),
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

test('floor and live-to-live catchup signal revisions, no-op and rollback do not', async () => {
  await withFixture(url, async (fixture) => {
    const authoring = await roundAuthoring(fixture, url);
    const { database, roundId, rules } = authoring;
    const segmentId = createId();
    try {
      await createScheduledRound(authoring, 'Revision completeness');
      const initial = await database.getRound(roundId);
      if (!initial) throw new Error('Round missing');
      await database.applyRoundExecution({
        roundId,
        expectedVersion: 1,
        command: null,
        buildProjection: (now) => ({
          round: {
            status: 'active',
            currentStage: 'live',
            startedAt: now,
            completedAt: null,
            outcome: null,
            checkpoint: initial.checkpoint,
          },
          segmentInserts: [
            {
              id: segmentId,
              sequence: 0,
              type: rules.segments[0]!.type,
              rulesSegmentKey: rules.segments[0]!.key,
              durationMs: rules.segments[0]!.durationMs,
              startedAt: now,
            },
          ],
          segmentCloses: [],
          effects: [],
        }),
      });
      const started = await database.getRound(roundId);
      if (!started) throw new Error('Round missing');
      const participant = await fixture.seat(roundId, 'affirmative');
      const base = {
        status: started.status,
        currentStage: started.currentStage,
        startedAt: started.startedAt,
        completedAt: started.completedAt,
        outcome: started.outcome,
        checkpoint: started.checkpoint,
      };
      const floor = {
        ...base,
        checkpoint: {
          ...base.checkpoint,
          floor: { holder_participant_id: participant.id, granted_at: instant },
        },
      };
      await database.applyRoundExecution({
        roundId,
        expectedVersion: 2,
        command: null,
        buildProjection: () => ({
          round: floor,
          segmentInserts: [],
          segmentCloses: [],
          effects: [],
        }),
      });
      const successor = rules.segments[1]!;
      await database.applyRoundExecution({
        roundId,
        expectedVersion: 3,
        command: null,
        buildProjection: (now) => ({
          round: base,
          segmentInserts: [
            {
              id: createId(),
              sequence: 1,
              type: successor.type,
              rulesSegmentKey: successor.key,
              durationMs: successor.durationMs,
              startedAt: now,
            },
          ],
          segmentCloses: [{ id: segmentId, endedAt: now }],
          effects: [],
        }),
      });
      await database.applyRoundExecution({
        roundId,
        expectedVersion: 4,
        command: null,
        buildProjection: () => ({
          round: base,
          segmentInserts: [],
          segmentCloses: [],
          effects: [],
        }),
      });
      // Duplicate sequence fails after round update; transaction must roll back its revision and event.
      await database
        .applyRoundExecution({
          roundId,
          expectedVersion: 4,
          command: null,
          buildProjection: (now) => ({
            round: floor,
            segmentInserts: [
              {
                id: createId(),
                sequence: 1,
                type: successor.type,
                rulesSegmentKey: successor.key,
                durationMs: successor.durationMs,
                startedAt: now,
              },
            ],
            segmentCloses: [],
            effects: [],
          }),
        })
        .then(
          () => {
            throw new Error('Invalid write accepted');
          },
          () => undefined,
        );
      const rows = await fixture.sql.unsafe(
        'select payload from outbox where topic = $1 order by seq',
        [buildDebateTopic(roundId)],
      );
      assert({
        given:
          'phase, interruption and live-to-live transitions followed by no-op and failed insert',
        should:
          'commit exactly one event per observable revision, with atomic rollback',
        actual: {
          versions: rows.map(
            (row: { payload: { entityVersion: number } }) =>
              row.payload.entityVersion,
          ),
          version: (await database.getRound(roundId))?.version,
        },
        expected: { versions: [2, 3, 4], version: 4 },
      });
    } finally {
      await database.close();
    }
  });
});
