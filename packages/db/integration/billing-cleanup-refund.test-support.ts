import type { TransactionSQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { advanceRefund, refundActionSchema } from '@daisy/protocol/billing';

/** Controlled positive provider outcome through the real ready/claim/observe guards; never vendor proof. */
export async function settleCandidateRefund(
  tx: TransactionSQL,
  jobId: string,
  id: string,
) {
  const [owner] =
    await tx`select job.subject_ref,account.deleted_at,customer.mode,customer.vendor_customer_id
    from privacy_jobs job join users account on account.id=job.subject_ref
    join billing_customers customer on customer.user_id=account.id where job.id=${jobId}`;
  if (!owner) throw Error('Missing original owned refund route');
  const [clock] =
    await tx`select date_trunc('milliseconds',clock_timestamp()) as at`;
  const at = clock!.at as Date;
  const action = refundActionSchema.parse({
    id,
    userId: owner.subject_ref,
    mode: owner.mode,
    customerId: owner.vendor_customer_id,
    chargeId: `ch_${createId()}`,
    invoiceId: `in_${createId()}`,
    vendorSubscriptionId: `sub_${createId()}`,
    amountMinor: 1000,
    currency: 'usd',
    paidAtSeconds: Math.floor(owner.deleted_at.getTime() / 1000) + 1,
    closedAt: owner.deleted_at.toISOString(),
    admittedAt: at.toISOString(),
    period: {
      startsAt: new Date(at.getTime() - 86400000).toISOString(),
      endsAt: new Date(at.getTime() + 29 * 86400000).toISOString(),
    },
    state: { kind: 'ready' },
    claim: null,
  });
  await tx`insert into billing_refund_actions(id,user_id,mode,vendor_customer_id,vendor_charge_id,vendor_invoice_id,vendor_subscription_id,amount_minor,currency,paid_at_seconds,closed_at,admitted_at,period_starts_at,period_ends_at,state)
    values(${action.id},${action.userId},${action.mode},${action.customerId},${action.chargeId},${action.invoiceId},${action.vendorSubscriptionId},${action.amountMinor},${action.currency},${action.paidAtSeconds},${action.closedAt}::timestamptz,${action.admittedAt}::timestamptz,${action.period.startsAt}::timestamptz,${action.period.endsAt}::timestamptz,'{"kind":"ready"}'::jsonb)`;
  const claimId = createId();
  const claimed = advanceRefund(
    action,
    { kind: 'claim', claimId },
    { now: at.toISOString(), authority: 'closed' },
  );
  if (claimed.kind !== 'changed')
    throw Error('Controlled refund claim refused');
  await tx`update billing_refund_actions set state=${JSON.stringify(claimed.action.state)}::text::jsonb,claim=${JSON.stringify(claimed.action.claim)}::text::jsonb where id=${id}`;
  const [observed] =
    await tx`select date_trunc('milliseconds',clock_timestamp()) as at`;
  const known = advanceRefund(
    claimed.action,
    {
      kind: 'observe',
      claimId,
      refundId: `re_${createId()}`,
      status: 'succeeded',
    },
    { now: observed!.at.toISOString(), authority: 'closed' },
  );
  if (known.kind !== 'changed')
    throw Error('Controlled positive refund refused');
  await tx`update billing_refund_actions set state=${JSON.stringify(known.action.state)}::text::jsonb,claim=null where id=${id}`;
}
