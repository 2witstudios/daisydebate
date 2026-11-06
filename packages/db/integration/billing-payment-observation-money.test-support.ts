import type { TransactionSQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { assert } from 'riteway/bun';

export async function exerciseObservedMoney(input: {
  readonly tx: TransactionSQL;
  readonly userId: string;
  readonly customerId: string;
  readonly invoiceId: string;
  readonly subscriptionId: string;
  readonly source: Record<string, unknown>;
  readonly closedAt: Date;
  readonly probe: (work: () => Promise<unknown>) => Promise<unknown>;
}) {
  const {
    tx,
    userId,
    customerId,
    invoiceId,
    subscriptionId,
    source,
    closedAt,
    probe,
  } = input;
  const paidAtSeconds = Math.floor(closedAt.getTime() / 1000) + 1;
  await tx`select pg_sleep(greatest(0,extract(epoch from to_timestamp(${paidAtSeconds})-clock_timestamp()))+.01)`;
  const [clock] =
    await tx`select date_trunc('milliseconds',clock_timestamp()) as at`;
  const actionId = createId(),
    id = createId(),
    paymentId = `inpay_${createId()}`,
    chargeId = `ch_${createId()}`;
  const period = {
    startsAt: '2026-11-01T00:00:00.000Z',
    endsAt: '2026-12-01T00:00:00.000Z',
  };
  await tx`insert into billing_refund_actions(id,user_id,mode,vendor_customer_id,vendor_charge_id,vendor_invoice_id,vendor_subscription_id,amount_minor,currency,period_starts_at,period_ends_at,closed_at,paid_at_seconds,admitted_at,state)
    values(${actionId},${userId},'test',${customerId},${chargeId},${invoiceId},${subscriptionId},1000,'usd',${period.startsAt}::timestamptz,${period.endsAt}::timestamptz,${closedAt},${paidAtSeconds},${clock!.at},'{"kind":"ready"}'::jsonb)`;
  const payment = {
    mode: 'test',
    customerId,
    invoiceId,
    invoicePaymentId: paymentId,
    vendorSubscriptionId: subscriptionId,
    priceId: source.priceId,
    chargeId,
    amountMinor: 1000,
    currency: 'usd',
    paidAtSeconds,
    period,
  };
  const owed = {
    kind: 'owed',
    reason: 'refund_required',
    evidence: { kind: 'verified', payment },
  };
  await tx`insert into billing_payment_observations(id,user_id,mode,vendor_customer_id,vendor_invoice_id,kind,vendor_invoice_payment_id,source,state,closed_at,created_at,observed_at)
    values(${id},${userId},'test',${customerId},${invoiceId},'payment',${paymentId},${JSON.stringify(source)}::text::jsonb,${JSON.stringify(owed)}::text::jsonb,${closedAt},${clock!.at},${clock!.at})`;
  const linked = { kind: 'refund-linked', payment };
  const wrong = { ...linked, payment: { ...payment, amountMinor: 500 } };
  const invalid = await probe(
    () =>
      tx`update billing_payment_observations set refund_action_id=${actionId},state=${JSON.stringify(wrong)}::text::jsonb where id=${id}`,
  );
  await tx`update billing_payment_observations set refund_action_id=${actionId},state=${JSON.stringify(linked)}::text::jsonb where id=${id}`;
  assert({
    given:
      'an exact original owned action and a contradictory allocation claim',
    should:
      'refuse mismatched money facts and link only the existing original action without another key or amount',
    actual: [
      invalid,
      (
        await tx`select refund_action_id,state from billing_payment_observations where id=${id}`
      )[0],
    ],
    expected: ['23514', { refund_action_id: actionId, state: linked }],
  });
  const [original] =
    await tx`select * from billing_refund_actions where id=${actionId}`;
  await tx`delete from billing_customers where user_id=${userId}`;
  const codes = [
    await probe(
      () =>
        tx`update billing_payment_observations set refund_action_id=null,state=${JSON.stringify(owed)}::text::jsonb where id=${id}`,
    ),
    await probe(
      () =>
        tx`update billing_payment_observations set refund_action_id=${createId()} where id=${id}`,
    ),
    await probe(
      () =>
        tx`update billing_payment_observations set state='{"kind":"owed","reason":"payment_unresolved","evidence":{"kind":"partial","facts":{"status":null,"paidAtSeconds":null,"amountPaidMinor":null,"charge":{"kind":"unresolved"},"period":null}}}'::jsonb where id=${id}`,
    ),
  ];
  const conflict = {
    kind: 'owed',
    reason: 'conflicting_evidence',
    evidence: { kind: 'verified', payment },
  };
  await tx`update billing_payment_observations set state=${JSON.stringify(conflict)}::text::jsonb where id=${id}`;
  assert({
    given: 'mapping deletion and a later unresolved/conflicting observation',
    should:
      'preserve original action/routing/facts without unlinking, replacing or erasing it',
    actual: [
      codes,
      (
        await tx`select refund_action_id,state from billing_payment_observations where id=${id}`
      )[0],
      (await tx`select * from billing_refund_actions where id=${actionId}`)[0],
    ],
    expected: [
      ['23514', '23514', '23514'],
      { refund_action_id: actionId, state: conflict },
      original,
    ],
  });
}
