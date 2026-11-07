import type {
  ObservedClosurePayment,
  BillingPaymentObservation,
  PartialPaymentFacts,
} from './billing-payment-observation';

export const unknownPaymentFacts = (): PartialPaymentFacts => ({
  status: null,
  paidAtSeconds: null,
  amountPaidMinor: null,
  charge: { kind: 'unresolved' },
  period: null,
});

export function paymentProofFacts(
  payment: ObservedClosurePayment,
): PartialPaymentFacts {
  return {
    status: 'paid',
    paidAtSeconds: payment.paidAtSeconds,
    amountPaidMinor: payment.amountMinor,
    charge: {
      kind: 'observed',
      id: payment.chargeId,
      paid: true,
      capturedMinor: payment.amountMinor,
      currency: payment.currency,
    },
    period: payment.period,
  };
}
function statusConflict(
  before: PartialPaymentFacts['status'],
  after: PartialPaymentFacts['status'],
) {
  return (
    before !== null && after !== null && before !== after && before !== 'open'
  );
}
function chargeConflict(
  before: PartialPaymentFacts['charge'],
  after: PartialPaymentFacts['charge'],
) {
  if (before.kind !== 'observed' || after.kind !== 'observed') return false;
  return [
    [before.id, after.id],
    [before.paid, after.paid],
    [before.capturedMinor, after.capturedMinor],
    [before.currency, after.currency],
  ].some(
    ([old, current]) => old !== null && current !== null && old !== current,
  );
}
function financialConflict(
  before: PartialPaymentFacts,
  after: PartialPaymentFacts,
) {
  return (
    (before.paidAtSeconds !== null &&
      after.paidAtSeconds !== null &&
      before.paidAtSeconds !== after.paidAtSeconds) ||
    (before.amountPaidMinor !== null &&
      after.amountPaidMinor !== null &&
      before.amountPaidMinor !== after.amountPaidMinor) ||
    (before.period !== null &&
      after.period !== null &&
      (before.period.startsAt !== after.period.startsAt ||
        before.period.endsAt !== after.period.endsAt))
  );
}
/** Missing later facts cannot erase positively observed allocation evidence. Conflicts retain the original. */
export function mergePaymentFacts(
  before: PartialPaymentFacts,
  after: PartialPaymentFacts,
) {
  if (
    statusConflict(before.status, after.status) ||
    chargeConflict(before.charge, after.charge) ||
    financialConflict(before, after)
  )
    return { kind: 'conflict' as const, facts: before };
  return {
    kind: 'merged' as const,
    facts: {
      status: after.status ?? before.status,
      paidAtSeconds: before.paidAtSeconds ?? after.paidAtSeconds,
      amountPaidMinor: before.amountPaidMinor ?? after.amountPaidMinor,
      period: before.period ?? after.period,
      charge: mergeCharge(before.charge, after.charge),
    },
  };
}

function mergeCharge(
  before: PartialPaymentFacts['charge'],
  after: PartialPaymentFacts['charge'],
) {
  if (before.kind !== 'observed') return after;
  if (after.kind !== 'observed') return before;
  return {
    ...before,
    paid: before.paid ?? after.paid,
    capturedMinor: before.capturedMinor ?? after.capturedMinor,
    currency: before.currency ?? after.currency,
  };
}

type Payment = Extract<BillingPaymentObservation, { kind: 'payment' }>;
export function retainedPaymentEvidence(value: Payment) {
  return value.state.kind === 'refund-linked'
    ? { kind: 'verified' as const, payment: value.state.payment }
    : value.state.evidence;
}
