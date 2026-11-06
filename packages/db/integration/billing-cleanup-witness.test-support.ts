import type { TransactionSQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { billingPaymentObservationSchema } from '@daisy/protocol/billing';

export async function retainCandidateObservation(
  tx: TransactionSQL,
  jobId: string,
  id: string,
) {
  const [row] =
    await tx`update billing_payment_observations observation set observed_at=date_trunc('milliseconds',clock_timestamp())
    from privacy_jobs job where job.id=${jobId} and observation.user_id=job.subject_ref and observation.id=${id} returning observation.*`;
  if (!row) throw Error('Missing exact owned candidate observation');
  return billingPaymentObservationSchema.parse({
    id: row.id,
    userId: row.user_id,
    mode: row.mode,
    customerId: row.vendor_customer_id,
    invoiceId: row.vendor_invoice_id,
    kind: row.kind,
    source: row.source,
    state: row.state,
    closedAt: row.closed_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    observedAt: row.observed_at.toISOString(),
    ...(row.kind === 'payment'
      ? {
          invoicePaymentId: row.vendor_invoice_payment_id,
          refundActionId: row.refund_action_id,
        }
      : {}),
  });
}

/** Controlled positive retention facts for the actual-role cursor guard matrix, never vendor proof. */
export async function retainCandidateInvoice(
  tx: TransactionSQL,
  jobId: string,
  invoiceId: string,
  paymentId?: string,
) {
  const [owner] =
    await tx`select job.subject_ref,account.deleted_at,customer.mode,customer.vendor_customer_id
    from privacy_jobs job join users account on account.id=job.subject_ref
    join billing_customers customer on customer.user_id=account.id where job.id=${jobId}`;
  if (!owner) throw Error('Missing candidate owned invoice route');
  const source = {
    kind: 'unresolved',
    vendorSubscriptionId: null,
    priceId: null,
  };
  await tx`with sampled as materialized(select date_trunc('milliseconds',clock_timestamp()) as at)
    insert into billing_payment_observations(id,user_id,mode,vendor_customer_id,vendor_invoice_id,kind,source,state,closed_at,created_at,observed_at)
    select ${createId()},${owner.subject_ref},${owner.mode},${owner.vendor_customer_id},${invoiceId},'invoice',${JSON.stringify(source)}::text::jsonb,'{"kind":"owed","reason":"enumeration_unavailable"}'::jsonb,${owner.deleted_at},at,at from sampled
    on conflict(mode,vendor_invoice_id) where kind='invoice' do update set observed_at=excluded.observed_at`;
  if (paymentId) {
    const state = {
      kind: 'owed',
      reason: 'payment_unresolved',
      evidence: {
        kind: 'partial',
        facts: {
          status: null,
          paidAtSeconds: null,
          amountPaidMinor: null,
          charge: { kind: 'unresolved' },
          period: null,
        },
      },
    };
    await tx`with sampled as materialized(select date_trunc('milliseconds',clock_timestamp()) as at)
      insert into billing_payment_observations(id,user_id,mode,vendor_customer_id,vendor_invoice_id,kind,vendor_invoice_payment_id,source,state,closed_at,created_at,observed_at)
      select ${createId()},${owner.subject_ref},${owner.mode},${owner.vendor_customer_id},${invoiceId},'payment',${paymentId},${JSON.stringify(source)}::text::jsonb,${JSON.stringify(state)}::text::jsonb,${owner.deleted_at},at,at from sampled
      on conflict(mode,vendor_invoice_payment_id) where kind='payment' do update set observed_at=excluded.observed_at`;
  }
}

export async function candidateEffects(tx: TransactionSQL, jobId: string) {
  const [effects] = await tx`select
    (select count(*)::int from billing_customers where user_id=job.subject_ref) as "mappedCustomers",
    (select count(*)::int from billing_purchases where user_id=job.subject_ref and state->>'kind' not in ('admitted','abandoned','expired')) as "possiblePurchases",
    (select count(*)::int from billing_refund_actions where user_id=job.subject_ref)+(case when exists(select 1 from billing_payment_observations where user_id=job.subject_ref) then 1 else 0 end) as "retainedFinancialRoutes",
    exists(select 1 from billing_payment_observations observation left join billing_refund_actions action on action.id=observation.refund_action_id where observation.user_id=job.subject_ref and (observation.state->>'kind'='owed' or (observation.state->>'kind'='refund-linked' and not coalesce(action.state->>'kind'='known' and action.state->>'status'='succeeded',false)))) as "owedObservations"
    from privacy_jobs job where id=${jobId}`;
  if (!effects) throw Error('Missing candidate effects');
  return {
    mappedCustomers: Number(effects.mappedCustomers),
    possiblePurchases: Number(effects.possiblePurchases),
    retainedFinancialRoutes: Number(effects.retainedFinancialRoutes),
    owedObservations: effects.owedObservations === true,
  };
}
