import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { sqlStateOf } from './constraint-helpers';
import { withBillingRefunds } from './billing-refunds.test-support';
requireTestServices(process.env);
setupRitewayBun();

test('equal payment seconds remain owed at precise closure and runtime SQL cannot invent ordering', async () =>
  withBillingRefunds(async ({ fixture, refunds, userId, payment }) => {
    await fixture.sql`update users set deleted_at=date_trunc('second',deleted_at) where id=${userId}`;
    const [closed] =
      await fixture.sql`select deleted_at as at from users where id=${userId}`;
    const paidAtSeconds = closed!.at.getTime() / 1000;
    const result = await refunds.admit(userId, { ...payment, paidAtSeconds });
    assert({
      given: 'equal second-resolution payment and local closure timestamp',
      should:
        'retain an unresolved obligation without creating a refund action',
      actual: result.kind,
      expected: 'unresolved',
    });
    const connection = await fixture.sql.reserve();
    let direct: string;
    try {
      await connection`set role daisy_web`;
      direct = await sqlStateOf(
        () => connection`insert into billing_refund_actions(id,user_id,mode,vendor_customer_id,vendor_charge_id,vendor_invoice_id,vendor_subscription_id,amount_minor,currency,period_starts_at,period_ends_at,closed_at,paid_at_seconds,admitted_at,state)
      values(${createId()},${userId},'test',${payment.customerId},${payment.chargeId},${payment.invoiceId},${payment.vendorSubscriptionId},1000,'usd',${payment.period.startsAt}::timestamptz,${payment.period.endsAt}::timestamptz,${closed!.at},${paidAtSeconds},clock_timestamp(),'{"kind":"ready"}')`,
      );
    } finally {
      await connection`reset role`;
      connection.release();
    }
    assert({
      given: 'direct actual runtime-role admission of equal-second ordering',
      should: 'reject manufacturing refund eligibility',
      actual: direct,
      expected: '23514',
    });
  }));
