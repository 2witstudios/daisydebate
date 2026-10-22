import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createAttendanceFeature } from '../src/features/attendance/operations';
import { withRoomRuntime } from './round-runtime.test-support';
import { ownSpeech, botControlOptions } from './bot-control.test-support';
import { settleAttendanceFixture } from './attendance-evaluator.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('a bot speaker missing its whole window abandons once even after a relaunched worker reclaims', async () =>
  withRoomRuntime(async (f) => {
    const { roundId, claim } = await ownSpeech(f);
    const instances = [createId(), createId()];
    for (const instanceId of instances)
      await f.store.renewServiceInstance({ instanceId, role: 'web' });
    const evaluators = instances.map((instanceId) =>
      createAttendanceFeature({
        checkIns: f.store,
        evaluate: f.store.evaluateRoundAttendance,
        nextId: createId,
        instanceId,
      }),
    );
    const cleanup = await settleAttendanceFixture(
      { f, roundId, segmentId: claim.scope.segmentId },
      true,
      false,
      f.host.actorId,
    );
    const facts = async () =>
      (
        await f.sql`select (select status from rounds where id=${roundId}) as status,
        (select outcome from rounds where id=${roundId}) as outcome,
        (select coalesce(string_agg(decision,','),'') from round_attendance_adjudications where round_id=${roundId}) as decisions,
        (select count(*)::int from round_commands where round_id=${roundId} and type='adjudicate') as receipts,
        (select count(*)::int from rating_changes where round_id=${roundId}) as ratings`
      )[0];
    try {
      await f.sql`update round_bot_publications set lease_expires_at=clock_timestamp()-interval '55 seconds' where round_id=${roundId} and round_participant_id=${claim.scope.roundParticipantId}`;
      const target = (await f.store.scanRoundBotWorkers(64)).find(
        (candidate) => candidate.roundId === roundId,
      );
      if (!target)
        throw Error('Expected the lapsed bot seat to be reclaimable');
      const reclaimed = await f.store.claimRoundBotWorker(target);
      await f.store.verifyRoundBotWorker(reclaimed.scope, reclaimed.token);
      for (const instanceId of instances)
        await f.store.renewServiceInstance({ instanceId, role: 'web' });
      const results = await Promise.allSettled(
        evaluators.map((evaluator) => evaluator.evaluate(roundId)),
      );
      assert({
        given:
          'a bot speaker with no receipt for its whole window, reclaimed by a relaunched worker before two evaluators race',
        should:
          'abandon once with no winner or rating, never forfeit the bot on current lease state',
        actual: {
          epoch:
            reclaimed.scope.publicationEpoch > claim.scope.publicationEpoch,
          abandoned: results.filter(
            (result) =>
              result.status === 'fulfilled' &&
              result.value?.decision === 'abandoned',
          ).length,
          ...(await facts()),
        },
        expected: {
          epoch: true,
          abandoned: 1,
          status: 'abandoned',
          outcome: null,
          decisions: 'abandoned',
          receipts: 1,
          ratings: 0,
        },
      });
    } finally {
      await cleanup();
      for (const instanceId of instances)
        await f.sql`delete from service_instances where instance_id=${instanceId}`;
    }
  }, botControlOptions));
