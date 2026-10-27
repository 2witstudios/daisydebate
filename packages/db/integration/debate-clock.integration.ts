import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import {
  createScheduledRound,
  roundAuthoring,
  withFixture,
} from './constraint-helpers';
import { authoredRoundCommand } from './round-command.test-support';
setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('Round and interval stamps persist the injected PostgreSQL instant exactly and never restamp', async () => {
  await withFixture(url, async (fixture) => {
    const authoring = await roundAuthoring(fixture, url);
    const { database, roundId, rules } = authoring;
    try {
      await createScheduledRound(authoring, 'One clock proof');
      const before = await database.getRound(roundId);
      if (!before) throw new Error('Round missing');
      let firstInstant = '';
      const segmentId = createId();
      await database.executeRoundCommand({
        ...authoredRoundCommand(authoring, 1),
        buildProjection: ({ now }) => {
          firstInstant = now;
          return {
            round: {
              status: 'active',
              currentStage: 'live',
              startedAt: now,
              completedAt: null,
              outcome: null,
              checkpoint: before.checkpoint,
            },
            segmentInserts: [
              {
                id: segmentId,
                sequence: 0,
                type: rules.segments[0]!.type,
                rulesSegmentKey: rules.segments[0]!.key,
                startedAt: now,
                durationMs: rules.segments[0]!.durationMs,
              },
            ],
            segmentCloses: [],
            effects: [],
          };
        },
      });
      const started = await database.getRound(roundId);
      assert({
        given: 'one trusted post-lock start transition',
        should: 'hydrate byte-equal lifecycle and interval anchors',
        actual: [started?.startedAt, started?.segments[0]?.startedAt],
        expected: [firstInstant, firstInstant],
      });
      if (!started) throw new Error('Round missing');
      const active = {
        status: started.status,
        currentStage: started.currentStage,
        startedAt: started.startedAt,
        completedAt: started.completedAt,
        outcome: started.outcome,
        checkpoint: started.checkpoint,
      };
      await database.executeRoundTick({
        roundId,
        buildProjection: () => ({
          round: {
            ...active,
            checkpoint: {
              ...active.checkpoint,
              prep_consumed_ms: { affirmative: 100, negative: 0 },
            },
          },
          segmentInserts: [],
          segmentCloses: [],
          effects: [],
        }),
      });
      let completedAt = '';
      await database.executeRoundTick({
        roundId,
        buildProjection: ({ now }) => {
          completedAt = now;
          return {
            round: {
              ...active,
              status: 'completed',
              currentStage: null,
              completedAt: now,
              outcome: 'affirmative',
            },
            segmentInserts: [],
            segmentCloses: [{ id: segmentId, endedAt: now }],
            effects: [],
          };
        },
      });
      const completed = await database.getRound(roundId);
      assert({
        given: 'later active update and completion',
        should:
          'keep the original start and persist exactly the completion instant',
        actual: [
          completed?.startedAt,
          completed?.completedAt,
          completed?.segments[0]?.endedAt,
        ],
        expected: [firstInstant, completedAt, completedAt],
      });
    } finally {
      await database.close();
    }
  });
});
