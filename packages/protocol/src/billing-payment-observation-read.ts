import { z } from 'zod';
import { ownedInvoiceObservationSchema } from './billing-payment-observation-source';
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
  if (!samePaymentIdentity(value, request)) return refuse;
  const source = retainPaymentObservationSource(value, request.source, context);
  if (source.kind !== 'recorded') return refuse;
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
  value: Extract<BillingPaymentObservation, { kind: 'payment' }>,
  read: OwnedPaymentObservation,
) {
  return (
    value.mode === read.mode &&
    value.customerId === read.customerId &&
    value.invoiceId === read.invoiceId &&
    value.invoicePaymentId === read.invoicePaymentId
  );
}
