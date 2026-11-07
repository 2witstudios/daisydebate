import { canUseAiAllowance } from '@daisy/auth/authorization';
import { sql } from 'drizzle-orm';
import {
  refundUnservedPracticeLocked,
  lockBotAdmission,
  markLockedRoundBotModelCall,
} from '../src/round-bot-admission';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withTwoRoundAdmission } from './bot-admission.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('a practice that never reached a model call stops spending the allowance when its Round ends (ISSUE-469)', async () => {
  await withTwoRoundAdmission(
    async ({ fixture, run, firstRound, secondRound, actorId, admission }) => {
      const status = async () => {
        const s = await admission.readStatus(actorId);
        return [s.remaining, s.refusal];
      };
      const end = (roundId: string) =>
        run(async (tx) => {
          await tx.execute(
            sql`update rounds set status='abandoned',current_stage=null,completed_at=clock_timestamp() where id=${roundId}`,
          );
          await refundUnservedPracticeLocked(tx, roundId);
        });
      await admission.reserve({ actorId, roundId: firstRound });
      const live = await status();
      await end(firstRound);
      const ended = await status();
      await admission.reserve({ actorId, roundId: secondRound });
      await run(async (tx) => {
        await lockBotAdmission(tx);
        await markLockedRoundBotModelCall(tx, {
          roundId: secondRound,
          before: '2099-01-01T00:00:00.000Z',
          accountEligible: canUseAiAllowance,
        });
      });
      await end(secondRound);
      const counted = await status();
      const [refunds] =
        await fixture.sql`select count(*)::int n from usage_reservations where actor_id=${actorId} and state->>'kind'='refunded'`;
      assert({
        given:
          'a live uncounted practice, the same practice after its Round ended with no model call, then a counted practice that ended',
        should:
          'hold the slot while live, free it once ended uncounted, keep spending once counted, and record no refund',
        actual: { live, ended, counted, refunds: refunds!.n },
        // At the beta cap of 20 (ISSUE-646): one held, given back, held again.
        expected: {
          live: [19, null],
          ended: [20, null],
          counted: [19, null],
          refunds: 0,
        },
      });
    },
  );
});
