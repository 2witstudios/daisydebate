import { z } from 'zod';
import {
  ownedInvoiceObservationSchema,
  mergePaymentObservationSource,
} from './billing-payment-observation-source';
import {
  paymentObservationEvidenceSchema,
  type BillingPaymentObservation,
  type PaymentObservationContext,
} from './billing-payment-observation';
import {
  retainPaymentObservationFacts,
  retainPaymentObservationSource,
} from './billing-payment-observation-retention';
import {
  classifyPaymentChronology,
  classifyPaymentObservation,
} from './billing-payment-observation-policy';

export const ownedPaymentObservationSchema =
  ownedInvoiceObservationSchema.extend({
    invoicePaymentId: z
      .string()
      .max(255)
      .regex(/^inpay_[A-Za-z0-9_]+$/),
    evidence: paymentObservationEvidenceSchema,
  });
export type OwnedPaymentObservation = z.infer<
  typeof ownedPaymentObservationSchema
>;
const refuse = { kind: 'refuse' } as const;
/** An owned read enriches one exact identity; classification never creates refund authority. */
export function applyPaymentObservationRead(
  value: BillingPaymentObservation,
  read: unknown,
  context: PaymentObservationContext,
  action?: unknown,
) {
  const parsed = ownedPaymentObservationSchema.safeParse(read);
  if (!parsed.success || value.kind !== 'payment') return refuse;
  const request = parsed.data;
  if (
    !samePaymentIdentity(value, request) ||
    !coherentReadEvidence(request, value.closedAt)
  )
    return refuse;
  const sourceDecision = mergePaymentObservationSource(
    value.source,
    request.source,
  );
  const source = retainPaymentObservationSource(value, request.source, context);
  if (source.kind !== 'recorded') return refuse;
  // A recognized owned-source contradiction is already a decision, never authority for proof B.
  if (sourceDecision.kind === 'conflict') return source;
  const evidence = request.evidence;
  if (evidence.kind === 'verified')
    return classifyPaymentObservation(
      source.observation,
      evidence.payment,
      context,
      action,
    );
  const facts = retainPaymentObservationFacts(
    source.observation,
    evidence.facts,
    context,
  );
  if (facts.kind !== 'recorded' || evidence.kind === 'partial') return facts;
  return classifyPaymentChronology(facts.observation, evidence.proof, context);
}

function samePaymentIdentity(
  value: Pick<
    OwnedPaymentObservation,
    'mode' | 'customerId' | 'invoiceId' | 'invoicePaymentId'
  >,
  read: Pick<
    OwnedPaymentObservation,
    'mode' | 'customerId' | 'invoiceId' | 'invoicePaymentId'
  >,
) {
  return (
    value.mode === read.mode &&
    value.customerId === read.customerId &&
    value.invoiceId === read.invoiceId &&
    value.invoicePaymentId === read.invoicePaymentId
  );
}

function coherentReadEvidence(read: OwnedPaymentObservation, closedAt: string) {
  if (
    read.source.kind === 'purchase' &&
    Date.parse(read.source.admittedAt) > Date.parse(closedAt)
  )
    return false;
  const evidence = read.evidence;
  if (evidence.kind === 'partial') return true;
  const proof =
    evidence.kind === 'verified' ? evidence.payment : evidence.proof;
  if (
    !samePaymentIdentity(proof, read) ||
    !knownSourceMatches(read.source, proof)
  )
    return false;
  return (
    evidence.kind !== 'chronology' ||
    (evidence.facts.status === 'paid' &&
      evidence.facts.paidAtSeconds === evidence.proof.paidAtSeconds)
  );
}
function knownSourceMatches(
  source: OwnedPaymentObservation['source'],
  proof: { readonly priceId: string; readonly vendorSubscriptionId: string },
) {
  return (
    (source.priceId === null || source.priceId === proof.priceId) &&
    (source.vendorSubscriptionId === null ||
      source.vendorSubscriptionId === proof.vendorSubscriptionId)
  );
}
