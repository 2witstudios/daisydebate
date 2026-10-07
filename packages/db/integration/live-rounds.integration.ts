import { assert, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { roundAuthoring, withFixture } from './constraint-helpers';
import { integrationSuite } from './suite.test-support';

requireTestServices(process.env);
const { databaseUrl: url } = integrationSuite();

/**
 * The global ceiling on live AI practice. The cutover deleted
 * `countLiveAiDebates` along with the `ai_debates` table it counted, leaving
 * `limits.live` declared but never read — so every member's personal
 * allowance multiplied out with no service-wide bound at all.
 *
 * What is counted is *reserved, unfinished AI practice* rounds: `scheduled` and `active` still hold
 * seats, a reservation and a voice budget. A round that has been completed or
 * abandoned has given those back.
 */
test('countLiveRounds counts unfinished rounds and stops counting finished ones', async () => {
  await withFixture(url, async (fixture) => {
    const { database, rules, formatId } = await roundAuthoring(fixture, url);
    try {
      const make = async () => {
        const id = createId();
        fixture.track('rounds', id);
        await database.createRound({
          id,
          createdByActorId: null,
          resolution: 'live ceiling proof',
          competitionType: 'casual',
          length: 'full',
          formatId,
          formatVersion: 1,
          presetVersion: null,
          rules,
        });
        return id;
      };

      const baseline = await database.countLiveRounds();

      // Scheduled rounds are unfinished: they hold a reservation from the
      // moment they are created, before anyone presses start.
      const scheduled = await make();
      assert({
        given: 'an unfinished round without an AI reservation',
        should: 'leave AI capacity available',
        actual: (await database.countLiveRounds()) - baseline,
        expected: 0,
      });
      await database.reserveAiPractice({
        id: createId(),
        actorId: await fixture.actor(),
        roundId: scheduled,
      });
      const afterScheduled = await database.countLiveRounds();

      assert({
        given: 'a round created but not yet started',
        should: 'count as live',
        actual: { counted: afterScheduled - baseline, status: 'scheduled' },
        expected: { counted: 1, status: 'scheduled' },
      });

      // Drive it through the real write path — a round cannot jump
      // scheduled → completed (`rounds_lifecycle_check` requires a start), so
      // it starts first and then completes. That exercises the counting rule
      // against genuinely finished rows rather than a hand-edited status.
      const advance = async (to: 'active' | 'completed') => {
        const hydrated = await database.getRound(scheduled);
        if (!hydrated) throw new Error('the round did not hydrate');
        const now = new Date(await database.databaseNow()).toISOString();
        await database.applyRoundExecution({
          roundId: scheduled,
          expectedVersion: hydrated.version,
          command: {
            commandId: createId(),
            actorId: null,
            serviceId: 'integration',
            type: to === 'active' ? 'start' : 'complete',
            payloadDigest: (to === 'active' ? 'e' : 'f').repeat(64),
            result: { outcome: 'affirmative' },
          },
          projection: {
            round: {
              status: to,
              currentStage: to === 'active' ? 'countdown' : null,
              startedAt: now,
              completedAt: to === 'completed' ? now : null,
              outcome: to === 'completed' ? 'affirmative' : null,
              checkpoint: hydrated.checkpoint,
            },
            segmentInserts: [],
            segmentCloses: [],
            effects: [],
          },
        });
      };
      await advance('active');

      assert({
        given: 'a round started and still running',
        should: 'count as live',
        actual: (await database.countLiveRounds()) - baseline,
        expected: 1,
      });

      await advance('completed');

      const afterComplete = await database.countLiveRounds();

      assert({
        given: 'the round completed through the write path',
        should: 'stop counting as live',
        actual: {
          counted: afterComplete - baseline,
          status: (await database.getRound(scheduled))?.status ?? null,
        },
        expected: { counted: 0, status: 'completed' },
      });
    } finally {
      await database.close();
    }
  });
});
