import { fixedClock } from '@daisy/clock';
import {
  invoicePassSchema,
  ownedInvoiceObservationSchema,
} from '@daisy/protocol/billing';
import { normalizePaymentObservation } from './payment-observation-reader';
import {
  facts,
  owner,
  payment,
  charge,
  intent,
} from './closure-payment.test-support';

export { facts };
export const member = {
  ...payment,
  invoice: facts.invoice,
  payment: {
    type: 'payment_intent',
    payment_intent: { ...intent, latest_charge: charge },
  },
};
export const claimId = 'c'.repeat(24);
export const binding = ownedInvoiceObservationSchema.parse({
  mode: owner.mode,
  customerId: owner.customerId,
  invoiceId: facts.invoice.id,
  source: {
    kind: 'purchase',
    purchaseId: 'p'.repeat(24),
    priceId: owner.priceId,
    vendorSubscriptionId: owner.vendorSubscriptionId,
    admittedAt: facts.closedAt,
  },
});
const read = normalizePaymentObservation(member, {
  invoice: binding,
  paymentId: payment.id,
  closedAt: facts.closedAt,
  now: facts.now,
});
if (read.kind !== 'read') throw new Error('Invalid owned member fixture');

export const pass = (phase: 'retaining' | 'verify-head' | 'verify-invoice') => {
  const owner = {
    ...binding,
    userId: 'u'.repeat(24),
    closedAt: facts.closedAt,
    period: {
      startsAt: new Date(
        facts.invoice.lines.data[0]!.period.start * 1000,
      ).toISOString(),
      endsAt: new Date(
        facts.invoice.lines.data[0]!.period.end * 1000,
      ).toISOString(),
    },
  };
  const selected = {
    id: 'x'.repeat(24),
    jobId: 'j'.repeat(24),
    beganAt: facts.now,
    owner,
    afterId: phase === 'retaining' ? null : payment.id,
    comparison: {
      kind: 'bounded',
      reads: phase === 'retaining' ? [] : [read.read],
    },
    phase,
  };
  return invoicePassSchema.parse(
    phase === 'verify-invoice'
      ? {
          ...selected,
          head: {
            passId: selected.id,
            jobId: selected.jobId,
            claimId,
            kind: 'head',
            request: { invoiceId: owner.invoiceId, limit: 20 },
            owner,
            startedAt: facts.now,
            observedAt: facts.now,
            hasMore: false,
            reads: [read.read],
          },
        }
      : selected,
  );
};
export const clock = fixedClock(facts.now);
