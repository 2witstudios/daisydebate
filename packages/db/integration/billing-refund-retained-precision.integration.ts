import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { sqlStateOf } from './constraint-helpers';
import { withBillingRefunds } from './billing-refunds.test-support';
requireTestServices(process.env);
setupRitewayBun();
const predecessor = new URL(
  '../migrations/20261105141132_refund_claim_observation_guard/migration.sql',
  import.meta.url,
);
const correction = new URL(
  '../migrations/20261105204936_refund_payment_precision_authority/migration.sql',
  import.meta.url,
);

test('forward precision guard preserves populated predecessor facts while denying ready/unknown creation and retaining known reads', async () =>
  withBillingRefunds(async ({ fixture, userId, payment }) => {
    const rollback = new Error('Owned precision fixture rollback');
    try {
      await fixture.sql.begin(async (tx) => {
        // Exact predecessor and forward function DDL stay inside this rolled-back fixture transaction.
        await tx.unsafe(await Bun.file(predecessor).text());
        await tx`update users set deleted_at=date_trunc('second',deleted_at) where id=${userId}`;
        const ids = [createId(), createId(), createId()];
        for (const id of ids)
          await tx`insert into billing_refund_actions(id,user_id,mode,vendor_customer_id,vendor_charge_id,vendor_invoice_id,vendor_subscription_id,amount_minor,currency,period_starts_at,period_ends_at,closed_at,paid_at_seconds,admitted_at,state)
          select ${id},${userId},'test',${payment.customerId},${`ch_${id}`},${payment.invoiceId},${payment.vendorSubscriptionId},1000,'usd',${payment.period.startsAt}::timestamptz,${payment.period.endsAt}::timestamptz,deleted_at,extract(epoch from deleted_at)::bigint,clock_timestamp(),'{"kind":"ready"}' from users where id=${userId}`;
        const claim = async (
          id: string,
          work: 'create' | 'retrieve',
          initial = false,
        ) => {
          const claimId = createId();
          await tx`with sampled as materialized(select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as at)
            update billing_refund_actions set state=case when state->>'kind'='ready' then jsonb_build_object('kind','unknown','startedAt',sampled.at,'retryAt',sampled.at,'afterRefundId',null) else state end,
            claim=jsonb_build_object('id',${claimId}::text,'work',${work}::text,'claimedAt',sampled.at,'expiresAt',to_char((sampled.at::timestamptz+${initial ? 500 : 30000}*interval '1 millisecond') at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) from sampled where id=${id}`;
          return claimId;
        };
        await claim(ids[1]!, 'create', true);
        await claim(ids[2]!, 'create');
        const refundId = `re_${createId()}`;
        await tx`update billing_refund_actions set claim=null,state=jsonb_build_object('kind','known','startedAt',state->>'startedAt','refundId',${refundId}::text,'status','succeeded','observedAt',to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) where id=${ids[2]}`;
        const before =
          await tx`select id,vendor_charge_id,amount_minor,period_starts_at,period_ends_at,paid_at_seconds,state from billing_refund_actions where user_id=${userId} order by id`;
        await tx.unsafe(await Bun.file(correction).text());
        const after =
          await tx`select id,vendor_charge_id,amount_minor,period_starts_at,period_ends_at,paid_at_seconds,state from billing_refund_actions where user_id=${userId} order by id`;
        await tx`select pg_sleep(0.55)`;
        await tx`set local role daisy_web`;
        const failures = [];
        for (const id of ids.slice(0, 2)) {
          await tx`savepoint owned_precision_probe`;
          failures.push(await sqlStateOf(() => claim(id, 'create')));
          await tx`rollback to savepoint owned_precision_probe`;
          await tx`release savepoint owned_precision_probe`;
        }
        await claim(ids[2]!, 'retrieve');
        await tx`update billing_refund_actions set claim=null,state=jsonb_set(jsonb_set(state,'{status}','"failed"'),'{observedAt}',to_jsonb(to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))) where id=${ids[2]}`;
        const [known] =
          await tx`select state->>'refundId' as refund,state->>'status' as status from billing_refund_actions where id=${ids[2]}`;
        assert({
          given:
            'real populated predecessor equality rows and the exact forward function under the runtime role',
          should:
            'preserve all financial facts, refuse both fresh create paths, and retain known refund observation',
          actual: [after, failures, known],
          expected: [
            before,
            ['23514', '23514'],
            { refund: refundId, status: 'failed' },
          ],
        });
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  }));
