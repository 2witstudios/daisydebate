import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { sql, type SQL } from 'drizzle-orm';
import { causeChainMember } from '../src/capacity-refusal';
import { sqlStateOf } from './constraint-helpers';
import { withBillingRefunds } from './billing-refunds.test-support';

requireTestServices(process.env);
setupRitewayBun();

test('actual daisy_web refunds preserve original financial attribution and exclude destructive or invented observations', async () =>
  withBillingRefunds(
    async ({ fixture, pool, run, refunds, userId, payment }) => {
      const reserve = pool.reserve.bind(pool);
      pool.reserve = async (options) => {
        const connection = await reserve(options);
        await connection`set role daisy_web`;
        return connection;
      };
      const [role] = await run((tx) =>
        tx.execute(sql`select current_user as role`),
      );
      const admitted = await refunds.admit(userId, payment);
      if (!('action' in admitted)) throw Error('Refund fixture refused');
      const id = admitted.action.id;
      const execute = (statement: SQL) =>
        run((tx) => tx.execute(statement)).catch((error) => {
          throw causeChainMember((cause) => 'errno' in cause, error) ?? error;
        });
      const original = [
        sql`update billing_refund_actions set id=${createId()} where id=${id}`,
        sql`update billing_refund_actions set user_id=${createId()} where id=${id}`,
        sql`update billing_refund_actions set mode='live' where id=${id}`,
        sql`update billing_refund_actions set vendor_customer_id='cus_other' where id=${id}`,
        sql`update billing_refund_actions set vendor_charge_id='ch_other' where id=${id}`,
        sql`update billing_refund_actions set vendor_invoice_id='in_other' where id=${id}`,
        sql`update billing_refund_actions set vendor_subscription_id='sub_other' where id=${id}`,
        sql`update billing_refund_actions set amount_minor=999 where id=${id}`,
        sql`update billing_refund_actions set currency='eur' where id=${id}`,
        sql`update billing_refund_actions set period_starts_at=period_starts_at-interval '1 second' where id=${id}`,
        sql`update billing_refund_actions set period_ends_at=period_ends_at+interval '1 second' where id=${id}`,
        sql`update billing_refund_actions set closed_at=closed_at-interval '1 second' where id=${id}`,
        sql`update billing_refund_actions set paid_at_seconds=paid_at_seconds-1 where id=${id}`,
        sql`update billing_refund_actions set admitted_at=admitted_at+interval '1 millisecond' where id=${id}`,
      ];
      const failures = [];
      for (const mutation of original)
        failures.push(await sqlStateOf(() => execute(mutation)));
      const claim = await refunds.claim(id);
      if (!claim?.action.claim) throw Error('Missing refund claim');
      const refundId = `re_${createId()}`;
      await refunds.record(id, {
        kind: 'observe',
        claimId: claim.action.claim.id,
        refundId,
        status: 'succeeded',
      });
      const invalid = [
        sql`update billing_refund_actions set state=jsonb_set(state,'{refundId}','"re_other"') where id=${id}`,
        sql`update billing_refund_actions set state=jsonb_set(state,'{startedAt}','"2026-01-01T00:00:00.000Z"') where id=${id}`,
        sql`update billing_refund_actions set state='{"kind":"ready"}' where id=${id}`,
        sql`update billing_refund_actions set state=jsonb_set(state,'{status}','"failed"') where id=${id}`,
      ];
      const observations = [];
      for (const mutation of invalid)
        observations.push(await sqlStateOf(() => execute(mutation)));
      const deleted = await sqlStateOf(() =>
        execute(sql`delete from billing_refund_actions where id=${id}`),
      );
      const [permissions] =
        await fixture.sql`select has_table_privilege('daisy_web','billing_refund_actions','DELETE') as web_delete,has_table_privilege('daisy_realtime','billing_refund_actions','SELECT') as realtime_read`;
      assert({
        given:
          'real runtime-role writes and direct identity/period/amount/state mutations',
        should:
          'admit legitimate operations and reject every mutation or deletion with the intended guard',
        actual: [role!.role, failures, observations, deleted, permissions],
        expected: [
          'daisy_web',
          original.map(() => '23514'),
          invalid.map(() => '23514'),
          '42501',
          { web_delete: false, realtime_read: false },
        ],
      });
      const fabricated = await sqlStateOf(() =>
        execute(sql`update billing_refund_actions set
      state=jsonb_set(state,'{status}','"failed"'),
      claim=jsonb_build_object('id',${createId()}::text,'work','retrieve',
        'claimedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'expiresAt',to_char((clock_timestamp()+interval '30 seconds') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) where id=${id}`),
      );
      assert({
        given:
          'a new retrieve claim combined with invented failure before vendor I/O',
        should: 'refuse changing facts while acquiring authority',
        actual: fabricated,
        expected: '23514',
      });
      const fresh = await refunds.claim(id);
      if (!fresh?.action.claim) throw Error('Missing fresh refund claim');
      const backdated = await sqlStateOf(() =>
        execute(sql`update billing_refund_actions set
        state=jsonb_set(state,'{status}','"failed"'),claim=null where id=${id}`),
      );
      const uncertain = await refunds.record(id, {
        kind: 'unresolved',
        claimId: fresh.action.claim.id,
      });
      const [after] =
        await fixture.sql`select state,claim from billing_refund_actions where id=${id}`;
      assert({
        given:
          'a consumed observation predating its claim, followed by a genuine unresolved read',
        should:
          'reject backdating but allow uncertainty without refreshing the old status',
        actual: [backdated, uncertain, after!.state, after!.claim],
        expected: ['23514', 'changed', fresh.action.state, null],
      });
    },
  ));
