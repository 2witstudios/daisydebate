import { unknownPaymentFacts } from './billing-payment-observation-facts';
import {
  billingPaymentObservationSchema,
  type BillingPaymentObservation,
  type ObservedClosurePayment,
} from './billing-payment-observation';
import { refundActionSchema } from './billing-refund';
export const closedAt = '2026-11-05T00:00:02.500Z',
  now = '2026-11-05T00:00:06.000Z';
export const context = { userId: 'u'.repeat(24), closedAt, now };
export const owner = {
  id: 'o'.repeat(24),
  userId: context.userId,
  mode: 'test' as const,
  customerId: 'cus_owned',
  invoiceId: 'in_owned',
  closedAt,
  source: {
    kind: 'purchase' as const,
    purchaseId: 'p'.repeat(24),
    vendorSubscriptionId: 'sub_owned',
    priceId: 'price_original',
    admittedAt: '2026-11-01T00:00:00.000Z',
  },
  createdAt: '2026-11-05T00:00:05.000Z',
  observedAt: '2026-11-05T00:00:05.000Z',
};
export const proof: ObservedClosurePayment = {
  mode: 'test',
  customerId: owner.customerId,
  invoiceId: owner.invoiceId,
  invoicePaymentId: 'inpay_owned',
  vendorSubscriptionId: owner.source.vendorSubscriptionId,
  priceId: owner.source.priceId,
  chargeId: 'ch_owned',
  amountMinor: 1000,
  currency: 'usd',
  paidAtSeconds: Date.parse('2026-11-05T00:00:03.000Z') / 1000,
  period: {
    startsAt: '2026-11-01T00:00:00.000Z',
    endsAt: '2026-12-01T00:00:00.000Z',
  },
};
export function observation(): Extract<
  BillingPaymentObservation,
  { kind: 'payment' }
> {
  const value = billingPaymentObservationSchema.parse({
    ...owner,
    kind: 'payment',
    invoicePaymentId: 'inpay_owned',
    refundActionId: null,
    state: {
      kind: 'owed',
      reason: 'payment_unresolved',
      evidence: { kind: 'partial', facts: unknownPaymentFacts() },
    },
  });
  if (value.kind !== 'payment') throw Error('Expected payment fixture');
  return value;
}
export function originalAction() {
  const { priceId, invoicePaymentId, ...payment } = proof;
  void priceId;
  void invoicePaymentId;
  return refundActionSchema.parse({
    id: 'r'.repeat(24),
    userId: owner.userId,
    ...payment,
    closedAt,
    admittedAt: '2026-11-05T00:00:05.000Z',
    state: { kind: 'ready' },
    claim: null,
  });
}

export function chronologyProof(paidAtSeconds = proof.paidAtSeconds) {
  return {
    mode: proof.mode,
    customerId: proof.customerId,
    invoiceId: proof.invoiceId,
    invoicePaymentId: proof.invoicePaymentId,
    vendorSubscriptionId: proof.vendorSubscriptionId,
    priceId: proof.priceId,
    status: 'paid' as const,
    paidAtSeconds,
  };
}
