import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createAttendanceFeature } from '../src/features/attendance/operations';
import { createBotControl } from '../src/features/round-bots/control';
import { withRoomRuntime } from './round-runtime.test-support';
import { opponentSpeech, botControlOptions } from './bot-control.test-support';
setupRitewayBun();
requireTestServices(process.env);
test('idle bot control records actual opponent-speech attendance despite refused publication', async () => {
  await withRoomRuntime(
    async (f) => {
      const { roundId, claim } = await opponentSpeech(f);
      const round = (await f.store.getRound(roundId))!;
      const attendance = createAttendanceFeature({
        checkIns: f.store,
        evaluate: f.store.evaluateRoundAttendance,
        nextId: createId,
        instanceId: createId(),
      });
      const control = (current: typeof claim) =>
        createBotControl({
          claim: current,
          store: f.store,
          attendance,
          nextId: createId,
        });
      await assertRejects({
        given: 'the bot is not the speaker in the actual human speech',
        should: 'refuse actual media publication',
        actual: () =>
          f.store.verifyRoundBotPublication(claim.scope, claim.token),
        code: 'CONFLICT',
      });
      const receipts = await control(claim).pulse();
      const [stored] =
        await f.sql`select a.state,a.service_id,a.actor_id,c.received_at=a.received_at as first_stamp,
    a.resolved_at-a.received_at<=interval '900 milliseconds' as within_budget,
    c.participant_id,c.segment_id from round_check_ins c join round_check_in_attempts a using(command_id) where c.round_id=${roundId}`;
      assert({
        given:
          'actual opposite-side bot control while its publication is refused',
        should:
          'commit its own scoped first-PG receipt within900ms without floor, model or transcript authority',
        actual: [
          receipts.length,
          stored.state,
          stored.service_id,
          stored.actor_id,
          stored.first_stamp,
          stored.within_budget,
          stored.participant_id,
          stored.segment_id,
          (await f.store.getRound(roundId))!.version,
        ],
        expected: [
          1,
          'committed',
          claim.scope.serviceId,
          null,
          true,
          true,
          claim.scope.roundParticipantId,
          claim.scope.segmentId,
          round.version,
        ],
      });
      for (const [scope, code] of [
        [
          {
            ...claim.scope,
            publicationEpoch: claim.scope.publicationEpoch + 1,
          },
          'CONFLICT',
        ],
        [
          { ...claim.scope, serviceId: `agent-run:${createId()}` },
          'AUTHORIZATION',
        ],
      ] as const)
        await assertRejects({
          given: 'a stale epoch or foreign service control caller',
          should: 'refuse without recording another receipt',
          actual: () => control({ ...claim, scope }).pulse(),
          code,
        });
      assert({
        given: 'fresh idle control retries the same actual speech',
        should: 'discover no unrecorded own target and retain one receipt',
        actual: [
          (await control(claim).pulse()).length,
          (
            await f.sql`select command_id from round_check_ins where round_id=${roundId}`
          ).length,
        ],
        expected: [0, 1],
      });
    },
    botControlOptions,
  );
});
