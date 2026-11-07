import {
  subscriptionEvidenceSchema,
  type SubscriptionEvidence,
  type SubscriptionPeriod,
} from './billing';

type InvoicePeriod = {
  readonly invoiceId: string;
  readonly period: SubscriptionPeriod;
};
const samePeriod = (left: SubscriptionPeriod, right: SubscriptionPeriod) =>
  left.subscriptionId === right.subscriptionId &&
  left.startsAt === right.startsAt &&
  left.endsAt === right.endsAt;
function invoices(evidence: SubscriptionEvidence): readonly InvoicePeriod[] {
  const settlement = evidence.settlement;
  return settlement.kind === 'unpaid'
    ? []
    : settlement.kind === 'paid'
      ? [settlement]
      : [settlement, settlement.previous];
}
function paid(evidence: SubscriptionEvidence): InvoicePeriod | null {
  const settlement = evidence.settlement;
  return settlement.kind === 'unpaid'
    ? null
    : settlement.kind === 'paid'
      ? settlement
      : settlement.previous;
}
function coherent(evidence: readonly SubscriptionEvidence[]) {
  const facts = evidence.flatMap(invoices);
  return facts.every((fact) =>
    facts.every(
      (other) =>
        fact.period.subscriptionId === other.period.subscriptionId &&
        (fact.invoiceId !== other.invoiceId ||
          samePeriod(fact.period, other.period)),
    ),
  );
}
function newestPayment(
  previous: InvoicePeriod | null,
  next: InvoicePeriod | null,
) {
  if (!previous) return next;
  if (!next) return previous;
  return Date.parse(next.period.endsAt) > Date.parse(previous.period.endsAt)
    ? next
    : previous;
}
function settlement(
  previous: SubscriptionEvidence | null,
  next: SubscriptionEvidence,
): SubscriptionEvidence['settlement'] {
  const payment = newestPayment(previous && paid(previous), paid(next));
  if (!payment) return { kind: 'unpaid' };
  const failures = [next, ...(previous ? [previous] : [])]
    .map((evidence) => evidence.settlement)
    .filter((value) => value.kind === 'renewal_failed');
  const failure = failures.find(
    (value) =>
      value.previous.invoiceId === payment.invoiceId &&
      samePeriod(value.previous.period, payment.period) &&
      value.period.startsAt === payment.period.endsAt,
  );
  return (
    failure ?? {
      kind: 'paid',
      invoiceId: payment.invoiceId,
      period: payment.period,
    }
  );
}

/** Current claim/mapping/account fences belong to persistence; invoice facts never move backwards. */
export function reconcileSubscriptionEvidence(
  previous: SubscriptionEvidence | null,
  next: SubscriptionEvidence,
): SubscriptionEvidence | null {
  if (
    !subscriptionEvidenceSchema.safeParse(next).success ||
    (previous !== null &&
      !subscriptionEvidenceSchema.safeParse(previous).success) ||
    !coherent(previous ? [previous, next] : [next])
  )
    return null;
  const terminal =
    previous?.lifecycle === 'canceled' ||
    previous?.lifecycle === 'incomplete_expired';
  return {
    lifecycle: terminal ? previous.lifecycle : next.lifecycle,
    settlement: settlement(previous, next),
  };
}
