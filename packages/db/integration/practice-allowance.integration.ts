import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withSponsoredAdmission } from './bot-admission.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('a practice that never reached a model call stops spending the allowance when its Round ends (ISSUE-469)', async () => {
  await withSponsoredAdmission(
    async ({ fixture, firstRound, secondRound, actorId, admission }) => {
      const status = async () => {
        const s = await admission.readStatus(actorId);
        return [s.remaining, s.refusal];
      };
      const end = (roundId: string) =>
        fixture.sql`update rounds set status='abandoned',current_stage=null,completed_at=clock_timestamp() where id=${roundId}`;
      await admission.reserve({ actorId, roundId: firstRound });
      const live = await status();
      await end(firstRound);
      const ended = await status();
      const second = await admission.reserve({ actorId, roundId: secondRound });
      await fixture.sql`update usage_reservations set counted_at=clock_timestamp() where id=${second.id}`;
      await end(secondRound);
      const counted = await status();
      const [refunds] =
        await fixture.sql`select count(*)::int n from usage_reservations where actor_id=${actorId} and refunded_at is not null`;
      assert({
        given:
          'a live uncounted practice, the same practice after its Round ended with no model call, then a counted practice that ended',
        should:
          'hold the slot while live, free it once ended uncounted, keep spending once counted, and record no refund',
        actual: { live, ended, counted, refunds: refunds!.n },
        expected: {
          live: [0, 'allowance'],
          ended: [1, null],
          counted: [0, 'allowance'],
          refunds: 0,
        },
      });
    },
  );
});
