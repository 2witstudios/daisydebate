import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createDatabase } from '../src';
import { withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);
const instant = '2026-10-07T12:00:00.000Z';

test('a scheduled forfeit persists abandonment without a start instant or ballot', async () => {
  await withFixture(url, async (fixture) => {
    const roundId = await fixture.round();
    const database = createDatabase({ url, nextActorId: createId });
    try {
      const before = await database.getRound(roundId);
      if (!before) throw new Error('the scheduled round did not hydrate');
      await database.applyRoundExecution({
        roundId,
        expectedVersion: before.version,
        command: null,
        buildProjection: () => ({
          round: {
            status: 'abandoned',
            currentStage: null,
            startedAt: null,
            completedAt: instant,
            outcome: null,
            checkpoint: before.checkpoint,
          },
          segmentInserts: [],
          segmentCloses: [],
          effects: [],
        }),
      });
      const after = await database.getRound(roundId);
      assert({
        given: 'the scheduled forfeit projection at the PostgreSQL boundary',
        should: 'persist the lifecycle the schema allows',
        actual: [
          after?.status,
          after?.startedAt,
          after?.outcome,
          !!after?.completedAt,
        ],
        expected: ['abandoned', null, null, true],
      });
    } finally {
      await database.close();
    }
  });
});
