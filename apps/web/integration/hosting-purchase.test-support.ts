import type { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { inTabTestTransaction } from './tab-test-transaction.test-support';

/**
 * A personal tournament already paid to unlimited (ADR 0149): the fact a
 * suite needs before it switches recording on. Written as the owner role,
 * as Stripe settlement would leave it.
 */
export const seedPaidHosting = async (
  sql: SQL,
  lobbyId: string,
  payerUserId: string,
) => {
  const [principal] = await sql<
    { role: string }[]
  >`select current_user as role`;
  if (!principal) throw new Error('Test role unavailable');
  await inTabTestTransaction(sql, async (seed) => {
    await seed.unsafe('reset role');
    await seed`insert into tournament_hosting_purchases
      (id,lobby_id,payer_user_id,tier,amount,mode,state,vendor_session_id,vendor_payment_intent_id,paid_at)
      values (${createId()},${lobbyId},${payerUserId},'event_unlimited',19900,'test','paid',${`cs_test_${createId()}`},${`pi_${createId()}`},clock_timestamp())`;
    await seed.unsafe(
      'set local role "' + principal.role.replaceAll('"', '""') + '"',
    );
  });
};
