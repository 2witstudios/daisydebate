import { createId } from '@paralleldrive/cuid2';
import { withClosedPurchase } from './billing-cleanup-purchases.test-support';
type Fixture = Parameters<Parameters<typeof withClosedPurchase>[1]>[0];
export async function fullRead(input: Fixture) {
  const { fixture, subject, session } = input;
  const [row] =
    await fixture.sql`select users.deleted_at,billing_purchases.id,billing_purchases.admitted_at from users join billing_purchases on billing_purchases.user_id=users.id where users.id=${subject.userId}`;
  const paidAtSeconds = Math.floor(row!.deleted_at.getTime() / 1000) + 1;
  await fixture.sql`select pg_sleep(greatest(0,extract(epoch from to_timestamp(${paidAtSeconds})-clock_timestamp()))+.01)`;
  await input.renew();
  const invoiceId = `in_${createId()}`,
    invoicePaymentId = `inpay_${createId()}`;
  const source = {
    kind: 'purchase',
    purchaseId: row!.id,
    priceId: 'price_fixture',
    vendorSubscriptionId: session.subscriptionId,
    admittedAt: row!.admitted_at.toISOString(),
  };
  return {
    mode: 'test',
    customerId: session.customerId,
    invoiceId,
    invoicePaymentId,
    source,
    evidence: {
      kind: 'verified',
      payment: {
        mode: 'test',
        customerId: session.customerId,
        invoiceId,
        invoicePaymentId,
        vendorSubscriptionId: session.subscriptionId,
        priceId: 'price_fixture',
        chargeId: `ch_${createId()}`,
        amountMinor: 1000,
        currency: 'usd',
        paidAtSeconds,
        period: {
          startsAt: source.admittedAt,
          endsAt: new Date(
            row!.admitted_at.getTime() + 30 * 86400000,
          ).toISOString(),
        },
      },
    },
  } as const;
}
