import { z } from 'zod';
import { idSchema } from './primitives';
import { closurePaymentDisposition } from './billing-refund';

const instant = z.iso.datetime({ precision: 3 });
const vendorId = (prefix: string) =>
  z
    .string()
    .max(255)
    .regex(new RegExp(`^${prefix}_[A-Za-z0-9_]+$`));
const minor = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const seconds = z
  .number()
  .int()
  .nonnegative()
  .refine((value) => Number.isSafeInteger(value * 1000));
const period = z
  .strictObject({ startsAt: instant, endsAt: instant })
  .refine((value) => Date.parse(value.startsAt) < Date.parse(value.endsAt));
/** Unknown source knowledge never substitutes today's offer or an invented purchase. */
export const paymentObservationSourceSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('unresolved'),
    vendorSubscriptionId: vendorId('sub').nullable(),
    priceId: vendorId('price').nullable(),
  }),
  z.strictObject({
    kind: z.literal('purchase'),
    purchaseId: idSchema,
    vendorSubscriptionId: vendorId('sub'),
    priceId: vendorId('price'),
    admittedAt: instant,
  }),
]);
export type PaymentObservationSource = z.infer<
  typeof paymentObservationSourceSchema
>;
/** Null means not positively verified. Zero is retained only as an actual observed amount. */
export const partialPaymentFactsSchema = z.strictObject({
  status: z.enum(['open', 'paid', 'canceled']).nullable(),
  paidAtSeconds: seconds.nullable(),
  amountPaidMinor: minor.nullable(),
  charge: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('unresolved') }),
    z.strictObject({
      kind: z.literal('observed'),
      id: vendorId('ch'),
      paid: z.boolean().nullable(),
      capturedMinor: minor.nullable(),
      currency: z
        .string()
        .regex(/^[a-z]{3}$/)
        .nullable(),
    }),
  ]),
  period: period.nullable(),
});
export type PartialPaymentFacts = z.infer<typeof partialPaymentFactsSchema>;
/** Complete linked allocation facts; this shape alone is never permission to create money effects. */
const paymentBinding = {
  mode: z.enum(['test', 'live']),
  customerId: vendorId('cus'),
  invoiceId: vendorId('in'),
  vendorSubscriptionId: vendorId('sub'),
  priceId: vendorId('price'),
  invoicePaymentId: vendorId('inpay'),
};
export const observedPaymentChronologySchema = z.strictObject({
  ...paymentBinding,
  status: z.literal('paid'),
  paidAtSeconds: seconds,
});
export type ObservedPaymentBinding = z.infer<
  typeof observedPaymentChronologySchema
>;
export const observedClosurePaymentSchema = z.strictObject({
  ...paymentBinding,
  chargeId: vendorId('ch'),
  amountMinor: minor.positive(),
  currency: z.literal('usd'),
  paidAtSeconds: seconds,
  period,
});
export type ObservedClosurePayment = z.infer<
  typeof observedClosurePaymentSchema
>;
const chronologyEvidence = z.strictObject({
  kind: z.literal('chronology'),
  proof: observedPaymentChronologySchema,
  facts: partialPaymentFactsSchema,
});
export const paymentObservationEvidenceSchema = z.discriminatedUnion('kind', [
  chronologyEvidence,
  z.strictObject({
    kind: z.literal('partial'),
    facts: partialPaymentFactsSchema,
  }),
  z.strictObject({
    kind: z.literal('verified'),
    payment: observedClosurePaymentSchema,
  }),
]);
/** Constructed only after an owned bounded traversal durably retains every returned identity. */
export const invoiceEnumerationCoverageSchema = z.strictObject({
  kind: z.literal('complete'),
  mode: z.enum(['test', 'live']),
  customerId: vendorId('cus'),
  invoiceId: vendorId('in'),
  paymentCount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  lastPaymentId: vendorId('inpay'),
});
const invoiceEnumerationStateSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('owed'),
    reason: z.enum(['enumeration_unavailable', 'conflicting_evidence']),
  }),
  z.strictObject({
    kind: z.literal('resolved'),
    basis: z.literal('enumeration_retained'),
    paymentCount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    lastPaymentId: vendorId('inpay'),
  }),
]);
const paymentObservationStateSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('owed'),
    reason: z.enum([
      'payment_unresolved',
      'chronology_ambiguous',
      'refund_required',
      'conflicting_evidence',
    ]),
    evidence: paymentObservationEvidenceSchema,
  }),
  z.strictObject({
    kind: z.literal('resolved'),
    basis: z.literal('pre_closure'),
    evidence: z.discriminatedUnion('kind', [
      chronologyEvidence,
      z.strictObject({
        kind: z.literal('verified'),
        payment: observedClosurePaymentSchema,
      }),
    ]),
  }),
  z.strictObject({
    kind: z.literal('refund-linked'),
    payment: observedClosurePaymentSchema,
  }),
]);
export type PaymentObservationState = z.infer<
  typeof paymentObservationStateSchema
>;
export const billingPaymentObservationStateSchema = z.union([
  invoiceEnumerationStateSchema,
  paymentObservationStateSchema,
]);
const owner = {
  id: idSchema,
  userId: idSchema,
  mode: z.enum(['test', 'live']),
  customerId: vendorId('cus'),
  invoiceId: vendorId('in'),
  closedAt: instant,
  source: paymentObservationSourceSchema,
  createdAt: instant,
  observedAt: instant,
};
const observation = z.discriminatedUnion('kind', [
  z.strictObject({
    ...owner,
    kind: z.literal('invoice'),
    state: invoiceEnumerationStateSchema,
  }),
  z.strictObject({
    ...owner,
    kind: z.literal('payment'),
    invoicePaymentId: vendorId('inpay'),
    refundActionId: idSchema.nullable(),
    state: paymentObservationStateSchema,
  }),
]);
export type BillingPaymentObservation = z.infer<typeof observation>;
function paymentOf(
  value: Extract<BillingPaymentObservation, { kind: 'payment' }>,
) {
  const evidence =
    value.state.kind === 'refund-linked'
      ? { kind: 'verified' as const, payment: value.state.payment }
      : value.state.evidence;
  return evidence.kind === 'verified' ? evidence.payment : null;
}
function validObservationTime(value: BillingPaymentObservation) {
  return (
    Date.parse(value.createdAt) >= Date.parse(value.closedAt) &&
    Date.parse(value.observedAt) >= Date.parse(value.createdAt) &&
    (value.source.kind !== 'purchase' ||
      Date.parse(value.source.admittedAt) <= Date.parse(value.closedAt))
  );
}
export function ownsObservedPayment(
  value: Extract<BillingPaymentObservation, { kind: 'payment' }>,
  payment: Omit<ObservedPaymentBinding, 'status' | 'paidAtSeconds'>,
) {
  return (
    value.source.kind === 'purchase' &&
    payment.mode === value.mode &&
    payment.customerId === value.customerId &&
    payment.invoiceId === value.invoiceId &&
    payment.invoicePaymentId === value.invoicePaymentId &&
    payment.vendorSubscriptionId === value.source.vendorSubscriptionId &&
    payment.priceId === value.source.priceId
  );
}
function validMoneyBinding(
  value: Extract<BillingPaymentObservation, { kind: 'payment' }>,
) {
  if (value.refundActionId === null)
    return value.state.kind !== 'refund-linked';
  return (
    value.state.kind === 'refund-linked' ||
    (value.state.kind === 'owed' &&
      value.state.reason === 'conflicting_evidence' &&
      value.state.evidence.kind === 'verified')
  );
}
function chronologyMatches(
  value: Extract<BillingPaymentObservation, { kind: 'payment' }>,
  evidence: z.infer<typeof chronologyEvidence>,
) {
  return (
    ownsObservedPayment(value, evidence.proof) &&
    evidence.facts.status === 'paid' &&
    evidence.facts.paidAtSeconds === evidence.proof.paidAtSeconds &&
    closurePaymentDisposition({
      closedAt: value.closedAt,
      now: value.observedAt,
      paidAtSeconds: evidence.proof.paidAtSeconds,
    }) === 'pre-closure'
  );
}
function resolvedChronology(
  value: Extract<BillingPaymentObservation, { kind: 'payment' }>,
) {
  if (value.state.kind !== 'resolved') return false;
  const evidence = value.state.evidence;
  return evidence.kind === 'chronology'
    ? chronologyMatches(value, evidence)
    : closurePaymentDisposition({
        closedAt: value.closedAt,
        now: value.observedAt,
        paidAtSeconds: evidence.payment.paidAtSeconds,
      }) === 'pre-closure';
}
function validOwnedEvidence(
  value: Extract<BillingPaymentObservation, { kind: 'payment' }>,
) {
  const evidence =
    value.state.kind === 'refund-linked' ? null : value.state.evidence;
  if (evidence?.kind === 'chronology' && !chronologyMatches(value, evidence))
    return false;
  const payment = paymentOf(value);
  return payment === null || ownsObservedPayment(value, payment);
}
function validPaymentObservation(
  value: Extract<BillingPaymentObservation, { kind: 'payment' }>,
) {
  if (!validMoneyBinding(value) || !validOwnedEvidence(value)) return false;
  if (value.state.kind === 'resolved') return resolvedChronology(value);
  const payment = paymentOf(value);
  if (payment === null || value.state.kind === 'owed') return true;
  return payment.paidAtSeconds * 1000 <= Date.parse(value.observedAt);
}
export const billingPaymentObservationSchema = observation.refine(
  (value) =>
    validObservationTime(value) &&
    (value.kind === 'invoice' || validPaymentObservation(value)),
);

export type PaymentObservationContext = {
  readonly userId: string;
  readonly closedAt: string;
  readonly now: string;
};
export function currentPaymentObservation(
  value: BillingPaymentObservation,
  context: PaymentObservationContext,
) {
  return (
    billingPaymentObservationSchema.safeParse(value).success &&
    idSchema.safeParse(context.userId).success &&
    instant.safeParse(context.closedAt).success &&
    instant.safeParse(context.now).success &&
    value.userId === context.userId &&
    value.closedAt === context.closedAt &&
    Date.parse(context.now) >= Date.parse(value.observedAt)
  );
}
