import {
  billingPaymentObservationSchema,
  type BillingPaymentObservation,
} from '@daisy/protocol/billing';
import { billingPaymentObservations } from './schema/billing-payment-observations';

export const paymentObservationFromRow = (
  row: typeof billingPaymentObservations.$inferSelect,
) =>
  billingPaymentObservationSchema.parse({
    id: row.id,
    userId: row.userId,
    mode: row.mode,
    customerId: row.vendorCustomerId,
    invoiceId: row.vendorInvoiceId,
    kind: row.kind,
    source: row.source,
    state: row.state,
    closedAt: row.closedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    observedAt: row.observedAt.toISOString(),
    ...(row.kind === 'payment'
      ? {
          invoicePaymentId: row.vendorInvoicePaymentId,
          refundActionId: row.refundActionId,
        }
      : {}),
  });
export const paymentObservationValues = (value: BillingPaymentObservation) => ({
  id: value.id,
  userId: value.userId,
  mode: value.mode,
  vendorCustomerId: value.customerId,
  vendorInvoiceId: value.invoiceId,
  kind: value.kind,
  vendorInvoicePaymentId:
    value.kind === 'payment' ? value.invoicePaymentId : null,
  refundActionId: value.kind === 'payment' ? value.refundActionId : null,
  source: value.source,
  state: value.state,
  closedAt: new Date(value.closedAt),
  createdAt: new Date(value.createdAt),
  observedAt: new Date(value.observedAt),
});
