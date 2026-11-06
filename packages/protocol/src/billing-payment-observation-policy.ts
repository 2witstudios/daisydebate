import { retainPaymentObservationFacts } from './billing-payment-observation-retention';
import {
  mergePaymentFacts,
  retainedPaymentEvidence,
  paymentProofFacts,
  unknownPaymentFacts,
} from './billing-payment-observation-facts';
import {
  closurePaymentDisposition,
  refundActionSchema,
  type RefundAction,
} from './billing-refund';
import {
  billingPaymentObservationSchema,
  currentPaymentObservation,
  observedClosurePaymentSchema,
  observedPaymentChronologySchema,
  ownsObservedPayment,
  type BillingPaymentObservation,
  type ObservedClosurePayment,
  type PaymentObservationContext,
  type PaymentObservationState,
} from './billing-payment-observation';
type Payment = Extract<BillingPaymentObservation, { kind: 'payment' }>;
const refuse = { kind: 'refuse' } as const;
function matchesAction(
  value: Payment,
  payment: ObservedClosurePayment,
  action: RefundAction,
) {
  return (
    action.userId === value.userId &&
    action.closedAt === value.closedAt &&
    action.mode === payment.mode &&
    action.customerId === payment.customerId &&
    action.invoiceId === payment.invoiceId &&
    action.vendorSubscriptionId === payment.vendorSubscriptionId &&
    sameActionMoney(payment, action)
  );
}
function sameActionMoney(
  payment: ObservedClosurePayment,
  action: RefundAction,
) {
  return (
    action.chargeId === payment.chargeId &&
    action.amountMinor === payment.amountMinor &&
    action.paidAtSeconds === payment.paidAtSeconds &&
    action.period.startsAt === payment.period.startsAt &&
    action.period.endsAt === payment.period.endsAt
  );
}
function validAction(
  value: Payment,
  payment: ObservedClosurePayment,
  action: unknown,
  now: string,
) {
  const parsed = refundActionSchema.safeParse(action);
  return parsed.success &&
    Date.parse(parsed.data.admittedAt) <= Date.parse(now) &&
    matchesAction(value, payment, parsed.data)
    ? parsed.data
    : null;
}
function retainedPayment(value: Payment): ObservedClosurePayment | null {
  const evidence = retainedPaymentEvidence(value);
  return evidence.kind === 'verified' ? evidence.payment : null;
}
function conflictingPayment(value: Payment, payment: ObservedClosurePayment) {
  if (
    value.state.kind === 'owed' &&
    value.state.reason === 'conflicting_evidence'
  )
    return true;
  const previous = retainedPayment(value);
  if (previous !== null) return !samePayment(previous, payment);
  const evidence = retainedPaymentEvidence(value);
  return (
    evidence.kind !== 'verified' &&
    mergePaymentFacts(evidence.facts, paymentProofFacts(payment)).kind ===
      'conflict'
  );
}
function samePayment(
  left: ObservedClosurePayment,
  right: ObservedClosurePayment,
) {
  return (
    left.chargeId === right.chargeId &&
    left.amountMinor === right.amountMinor &&
    left.paidAtSeconds === right.paidAtSeconds &&
    left.period.startsAt === right.period.startsAt &&
    left.period.endsAt === right.period.endsAt
  );
}
function conflictingDecision(value: Payment, payment: ObservedClosurePayment) {
  return {
    state: {
      kind: 'owed' as const,
      reason: 'conflicting_evidence' as const,
      evidence: { kind: 'verified' as const, payment },
    },
    refundActionId: value.refundActionId,
  };
}
function decide(
  value: Payment,
  payment: ObservedClosurePayment,
  context: PaymentObservationContext,
  action: unknown,
): { state: PaymentObservationState; refundActionId: string | null } {
  const existing = validAction(value, payment, action, context.now);
  if (value.refundActionId !== null)
    return retainedLinkDecision(value, payment, action, existing);
  if (action !== undefined && action !== null && existing === null)
    return conflictingDecision(value, payment);
  const disposition = closurePaymentDisposition({
    closedAt: value.closedAt,
    now: context.now,
    paidAtSeconds: payment.paidAtSeconds,
  });
  if (existing && (disposition === 'refund' || existing.state.kind !== 'ready'))
    return {
      state: { kind: 'refund-linked', payment },
      refundActionId: existing.id,
    };
  return {
    state: unlinkedDecision(payment, disposition),
    refundActionId: null,
  };
}
function retainedLinkDecision(
  value: Payment,
  payment: ObservedClosurePayment,
  action: unknown,
  existing: RefundAction | null,
): { state: PaymentObservationState; refundActionId: string | null } {
  if (
    action !== undefined &&
    action !== null &&
    (existing === null || existing.id !== value.refundActionId)
  )
    return conflictingDecision(value, payment);
  return {
    state: { kind: 'refund-linked', payment },
    refundActionId: value.refundActionId,
  };
}
function unlinkedDecision(
  payment: ObservedClosurePayment,
  disposition: ReturnType<typeof closurePaymentDisposition>,
): PaymentObservationState {
  if (disposition === 'pre-closure')
    return {
      kind: 'resolved',
      basis: 'pre_closure',
      evidence: { kind: 'verified', payment },
    };
  return {
    kind: 'owed',
    reason:
      disposition === 'refund' ? 'refund_required' : 'chronology_ambiguous',
    evidence: { kind: 'verified', payment },
  };
}
/** Classifies evidence or links existing money authority. It never emits a refund creation command/key. */
export function classifyPaymentObservation(
  value: BillingPaymentObservation,
  proof: unknown,
  context: PaymentObservationContext,
  action?: unknown,
) {
  if (value.kind !== 'payment' || !currentPaymentObservation(value, context))
    return refuse;
  const parsed = observedClosurePaymentSchema.safeParse(proof);
  if (!parsed.success || !ownsObservedPayment(value, parsed.data))
    return refuse;
  const decision = conflictingPayment(value, parsed.data)
    ? {
        state: {
          kind: 'owed' as const,
          reason: 'conflicting_evidence' as const,
          evidence: retainedPaymentEvidence(value),
        },
        refundActionId: value.refundActionId,
      }
    : decide(value, parsed.data, context, action);
  const next = billingPaymentObservationSchema.safeParse({
    ...value,
    ...decision,
    observedAt: context.now,
  });
  return next.success
    ? { kind: 'recorded' as const, observation: next.data }
    : refuse;
}
/** Refund-linked is not settled: current original action outcome remains the only money projection. */
export function paymentObservationComplete(
  value: BillingPaymentObservation,
  action?: unknown,
) {
  if (!billingPaymentObservationSchema.safeParse(value).success) return false;
  if (value.state.kind === 'resolved') return true;
  if (value.kind !== 'payment' || value.state.kind !== 'refund-linked')
    return false;
  const parsed = refundActionSchema.safeParse(action);
  return (
    parsed.success &&
    parsed.data.id === value.refundActionId &&
    matchesAction(value, value.state.payment, parsed.data) &&
    parsed.data.state.kind === 'known' &&
    parsed.data.state.status === 'succeeded'
  );
}

/** Paid chronology can prove an exact owned payment predates closure without inventing its charge/allocation. */
export function classifyPaymentChronology(
  value: BillingPaymentObservation,
  proof: unknown,
  context: PaymentObservationContext,
) {
  if (value.kind !== 'payment' || !currentPaymentObservation(value, context))
    return refuse;
  const parsed = observedPaymentChronologySchema.safeParse(proof);
  if (!parsed.success || !ownsObservedPayment(value, parsed.data))
    return refuse;
  const retained = retainPaymentObservationFacts(
    value,
    {
      ...unknownPaymentFacts(),
      status: 'paid',
      paidAtSeconds: parsed.data.paidAtSeconds,
    },
    context,
  );
  if (retained.kind !== 'recorded' || retained.observation.kind !== 'payment')
    return refuse;
  const nextValue = retained.observation;
  if (!mayResolveChronology(nextValue, parsed.data, context.now))
    return retained;
  const next = billingPaymentObservationSchema.safeParse({
    ...nextValue,
    state: {
      kind: 'resolved',
      basis: 'pre_closure',
      evidence: chronologyResolutionEvidence(nextValue, parsed.data),
    },
  });
  return next.success
    ? { kind: 'recorded' as const, observation: next.data }
    : refuse;
}

function mayResolveChronology(
  value: Payment,
  proof: ReturnType<typeof observedPaymentChronologySchema.parse>,
  now: string,
) {
  return (
    value.refundActionId === null &&
    !(
      value.state.kind === 'owed' &&
      value.state.reason === 'conflicting_evidence'
    ) &&
    closurePaymentDisposition({
      closedAt: value.closedAt,
      now,
      paidAtSeconds: proof.paidAtSeconds,
    }) === 'pre-closure'
  );
}

function chronologyResolutionEvidence(
  value: Payment,
  proof: ReturnType<typeof observedPaymentChronologySchema.parse>,
) {
  const retained = retainedPaymentEvidence(value);
  return retained.kind === 'verified'
    ? retained
    : { kind: 'chronology' as const, proof, facts: retained.facts };
}
