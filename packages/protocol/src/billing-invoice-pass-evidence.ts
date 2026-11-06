import {
  applyPaymentObservationRead,
  type OwnedPaymentObservation,
} from './billing-payment-observation-read';
import {
  billingPaymentObservationSchema,
  type BillingPaymentObservation,
  type PaymentObservationSource,
} from './billing-payment-observation';
import { retainedPaymentEvidence } from './billing-payment-observation-facts';
import { retainPaymentObservationSource } from './billing-payment-observation-retention';
import {
  sameInvoiceOwner,
  sameInvoicePassSource,
  type InvoicePassOwner,
  type InvoicePassAuthority,
} from './billing-invoice-pass';
const equal = (a: unknown, b: unknown) =>
  JSON.stringify(a) === JSON.stringify(b);
export function headRetention(
  owner: InvoicePassOwner,
  reads: readonly OwnedPaymentObservation[],
  rows: readonly BillingPaymentObservation[],
  context: InvoicePassAuthority,
) {
  if (
    rows.length !== reads.length ||
    new Set(reads.map((read) => read.invoicePaymentId)).size !== reads.length
  )
    return 'missing';
  const results = reads.map((read) => {
    const matching = rows.filter(
      (row) =>
        row.kind === 'payment' &&
        row.invoicePaymentId === read.invoicePaymentId,
    );
    return matching.length === 1
      ? readRetention(owner, read, matching[0]!, context)
      : 'missing';
  });
  return results.includes('missing')
    ? 'missing'
    : results.includes('conflict')
      ? 'conflict'
      : 'retained';
}
export function readRetention(
  owner: InvoicePassOwner,
  read: OwnedPaymentObservation,
  row: BillingPaymentObservation,
  context: InvoicePassAuthority,
) {
  const parsed = billingPaymentObservationSchema.safeParse(row);
  if (!parsed.success || parsed.data.kind !== 'payment') return 'missing';
  if (!currentRetainedRow(owner, parsed.data, context)) return 'missing';
  const result = applyPaymentObservationRead(parsed.data, read, {
    userId: owner.userId,
    closedAt: owner.closedAt,
    now: context.now,
  });
  if (
    result.kind !== 'recorded' ||
    !equal(
      {
        source: parsed.data.source,
        state: parsed.data.state,
        link: parsed.data.refundActionId,
      },
      {
        source: result.observation.source,
        state: result.observation.state,
        link:
          result.observation.kind === 'payment'
            ? result.observation.refundActionId
            : null,
      },
    )
  )
    return 'missing';
  if (retainedPeriodContradiction(owner, read, parsed.data)) return 'conflict';
  return parsed.data.state.kind === 'owed' &&
    parsed.data.state.reason === 'conflicting_evidence'
    ? 'conflict'
    : 'retained';
}

/** Current retained knowledge must contain the fresh read decision; unchanged replay does not refresh recognition time. */
export function readInvoicePassWitness(
  owner: InvoicePassOwner,
  source: PaymentObservationSource,
  row: BillingPaymentObservation,
  context: InvoicePassAuthority,
) {
  const parsed = billingPaymentObservationSchema.safeParse(row);
  if (!parsed.success || parsed.data.kind !== 'invoice') return null;
  const value = parsed.data;
  if (
    value.userId !== owner.userId ||
    value.closedAt !== owner.closedAt ||
    !sameInvoiceOwner(owner, value) ||
    Date.parse(value.observedAt) > Date.parse(context.now)
  )
    return null;
  const retained = retainPaymentObservationSource(value, source, {
    userId: owner.userId,
    closedAt: owner.closedAt,
    now: context.now,
  });
  return retained.kind === 'recorded' &&
    equal(
      { source: value.source, state: value.state },
      {
        source: retained.observation.source,
        state: retained.observation.state,
      },
    )
    ? value
    : null;
}

function currentRetainedRow(
  owner: InvoicePassOwner,
  row: BillingPaymentObservation,
  context: InvoicePassAuthority,
) {
  return (
    row.userId === owner.userId &&
    row.closedAt === owner.closedAt &&
    Date.parse(row.observedAt) <= Date.parse(context.now)
  );
}

function retainedPeriodMatches(
  owner: InvoicePassOwner,
  row: Extract<BillingPaymentObservation, { kind: 'payment' }>,
) {
  if (owner.period === null) return true;
  const evidence = retainedPaymentEvidence(row);
  const period =
    evidence.kind === 'verified'
      ? evidence.payment.period
      : evidence.facts.period;
  return period === null || equal(owner.period, period);
}

function retainedPeriodContradiction(
  owner: InvoicePassOwner,
  read: OwnedPaymentObservation,
  row: Extract<BillingPaymentObservation, { kind: 'payment' }>,
) {
  return (
    sameInvoicePassSource(owner, read) && !retainedPeriodMatches(owner, row)
  );
}
