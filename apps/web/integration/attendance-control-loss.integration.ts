import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createAttendanceFeature } from '../src/features/attendance/operations';
import { withRoomRuntime } from './round-runtime.test-support';
import { ownSpeech, botControlOptions } from './bot-control.test-support';
import { settleAttendanceFixture } from './attendance-evaluator.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('a bot speaker whose worker never returns postpones, then abandons once across evaluator takeover', async () =>
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
        (select coalesce(string_agg(decision,','),'') from round_attendance_adjudications where round_id=${roundId}) as decisions,
        (select count(*)::int from round_commands where round_id=${roundId} and type='adjudicate') as receipts,
        (select count(*)::int from rating_changes where round_id=${roundId}) as ratings`
      )[0];
    const loseControl = (seconds: number) =>
      f.sql`update round_bot_publications set lease_expires_at=clock_timestamp()-make_interval(secs=>${seconds}) where round_id=${roundId} and round_participant_id=${claim.scope.roundParticipantId}`;
    try {
      await loseControl(10);
      const postponed = await evaluators[0]!.evaluate(roundId);
      assert({
        given:
          'an absent bot speaker, a present human opponent and worker control lost 10 s ago',
        should: 'postpone durably instead of forfeiting the uncontrolled bot',
        actual: { postponed, ...(await facts()) },
        expected: {
          postponed: null,
          status: 'active',
          decisions: '',
          receipts: 0,
          ratings: 0,
        },
      });
      await loseControl(31);
      for (const instanceId of instances)
        await f.store.renewServiceInstance({ instanceId, role: 'web' });
      const results = await Promise.allSettled(
        evaluators.map((evaluator) => evaluator.evaluate(roundId)),
      );
      assert({
        given:
          'the same worker control unknown beyond the bound and two evaluator instances racing',
        should:
          'abandon once with no winner or rating; the other instance changes nothing',
        actual: {
          abandoned: results.filter(
            (result) =>
              result.status === 'fulfilled' &&
              result.value?.decision === 'abandoned',
          ).length,
          ...(await facts()),
        },
        expected: {
          abandoned: 1,
          status: 'abandoned',
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
