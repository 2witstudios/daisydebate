import { z } from 'zod';
import {
  paymentObservationSourceSchema,
  type PaymentObservationSource,
} from './billing-payment-observation';
/** An owned invoice identity is retained even when its payment enumeration is unavailable. */
export const ownedInvoiceObservationSchema = z.strictObject({
  mode: z.enum(['test', 'live']),
  customerId: z
    .string()
    .max(255)
    .regex(/^cus_[A-Za-z0-9_]+$/),
  invoiceId: z
    .string()
    .max(255)
    .regex(/^in_[A-Za-z0-9_]+$/),
  source: paymentObservationSourceSchema,
});
export type OwnedInvoiceObservation = z.infer<
  typeof ownedInvoiceObservationSchema
>;

/** A later unavailable offer is not authority to replace an original source. */
export function mergePaymentObservationSource(
  before: PaymentObservationSource,
  after: PaymentObservationSource,
) {
  const conflict =
    bindingConflict(before, after) ||
    (before.kind === 'purchase' &&
      after.kind === 'purchase' &&
      (before.purchaseId !== after.purchaseId ||
        before.admittedAt !== after.admittedAt));
  if (conflict) return { kind: 'conflict' as const, source: before };
  if (before.kind === 'purchase')
    return { kind: 'merged' as const, source: before };
  if (after.kind === 'purchase')
    return { kind: 'merged' as const, source: after };
  return {
    kind: 'merged' as const,
    source: {
      kind: 'unresolved' as const,
      vendorSubscriptionId:
        before.vendorSubscriptionId ?? after.vendorSubscriptionId,
      priceId: before.priceId ?? after.priceId,
    },
  };
}

function bindingConflict(
  before: PaymentObservationSource,
  after: PaymentObservationSource,
) {
  return [
    [before.vendorSubscriptionId, after.vendorSubscriptionId],
    [before.priceId, after.priceId],
  ].some(
    ([old, current]) => old !== null && current !== null && old !== current,
  );
}
