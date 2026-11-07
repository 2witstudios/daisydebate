import { mergePaymentObservationSource } from './billing-payment-observation-source';
import {
  mergePaymentFacts,
  paymentProofFacts,
  retainedPaymentEvidence,
} from './billing-payment-observation-facts';
import {
  billingPaymentObservationSchema,
  currentPaymentObservation,
  invoiceEnumerationCoverageSchema,
  partialPaymentFactsSchema,
  paymentObservationSourceSchema,
  type BillingPaymentObservation,
  type PaymentObservationContext,
  type PaymentObservationState,
  type PartialPaymentFacts,
} from './billing-payment-observation';
const refuse = { kind: 'refuse' } as const;
/** Exhaustion alone is not coverage; exact retained-identity proof is supplied by the fenced DB operation. */
export function recordInvoiceEnumeration(
  value: BillingPaymentObservation,
  coverage: unknown,
  context: PaymentObservationContext,
) {
  if (
    value.kind !== 'invoice' ||
    !currentPaymentObservation(value, context) ||
    (value.state.kind === 'owed' &&
      value.state.reason === 'conflicting_evidence')
  )
    return refuse;
  const parsed = invoiceEnumerationCoverageSchema.safeParse(coverage);
  if (
    !parsed.success ||
    parsed.data.mode !== value.mode ||
    parsed.data.customerId !== value.customerId ||
    parsed.data.invoiceId !== value.invoiceId
  )
    return refuse;
  const next = billingPaymentObservationSchema.safeParse({
    ...value,
    observedAt: context.now,
    state: {
      kind: 'resolved',
      basis: 'enumeration_retained',
      paymentCount: parsed.data.paymentCount,
      lastPaymentId: parsed.data.lastPaymentId,
    },
  });
  return next.success
    ? { kind: 'recorded' as const, observation: next.data }
    : refuse;
}

/** An unavailable/partial reread cannot forget earlier verified financial facts or resolve anything. */
export function retainPaymentObservationFacts(
  value: BillingPaymentObservation,
  facts: unknown,
  context: PaymentObservationContext,
) {
  if (value.kind !== 'payment' || !currentPaymentObservation(value, context))
    return refuse;
  const parsed = partialPaymentFactsSchema.safeParse(facts);
  if (!parsed.success) return refuse;
  const previous = retainedPaymentEvidence(value);
  const merged = mergePaymentFacts(
    previous.kind === 'verified'
      ? paymentProofFacts(previous.payment)
      : previous.facts,
    parsed.data,
  );
  const sticky =
    value.state.kind === 'owed' &&
    value.state.reason === 'conflicting_evidence';
  const state: PaymentObservationState =
    merged.kind === 'conflict' || sticky
      ? { kind: 'owed', reason: 'conflicting_evidence', evidence: previous }
      : retainedState(value, previous, merged.facts);
  const next = billingPaymentObservationSchema.safeParse({
    ...value,
    state,
    observedAt: context.now,
  });
  return next.success
    ? { kind: 'recorded' as const, observation: next.data }
    : refuse;
}

/** Enrich only missing original-source knowledge; conflicting rebinding stays owed. */
export function retainPaymentObservationSource(
  value: BillingPaymentObservation,
  source: unknown,
  context: PaymentObservationContext,
) {
  if (!currentPaymentObservation(value, context)) return refuse;
  const parsed = paymentObservationSourceSchema.safeParse(source);
  if (!parsed.success) return refuse;
  const merged = mergePaymentObservationSource(value.source, parsed.data);
  const state =
    merged.kind !== 'conflict'
      ? value.state
      : value.kind === 'invoice'
        ? { kind: 'owed' as const, reason: 'conflicting_evidence' as const }
        : {
            kind: 'owed' as const,
            reason: 'conflicting_evidence' as const,
            evidence: retainedPaymentEvidence(value),
          };
  const next = billingPaymentObservationSchema.safeParse({
    ...value,
    state,
    source: merged.source,
    observedAt: context.now,
  });
  return next.success
    ? { kind: 'recorded' as const, observation: next.data }
    : refuse;
}

function retainedState(
  value: Extract<BillingPaymentObservation, { kind: 'payment' }>,
  previous: ReturnType<typeof retainedPaymentEvidence>,
  facts: PartialPaymentFacts,
): PaymentObservationState {
  if (previous.kind === 'verified') return value.state;
  if (previous.kind === 'chronology')
    return value.state.kind === 'refund-linked'
      ? value.state
      : { ...value.state, evidence: { ...previous, facts } };
  return {
    kind: 'owed',
    reason: 'payment_unresolved',
    evidence: { kind: 'partial', facts },
  };
}
