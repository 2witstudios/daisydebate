import { eq } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import {
  classifyPaymentObservation,
  retainRefundAdmissionConflict,
  type BillingPaymentObservation,
  type PaymentObservationContext,
} from '@daisy/protocol/billing';
import type { BoundedTransactionContext } from './transaction-context';
import { admitRefundAction } from './billing-refund-admission';
import { billingPaymentObservations } from './schema/billing-payment-observations';
import { readDatabaseTime } from './database-clock';

/** The persisted verified source precedes money admission; both reuse the sole original-charge action. */
export async function linkObservedRefund(
  tx: BoundedTransactionContext,
  value: BillingPaymentObservation,
  input: {
    readonly context: PaymentObservationContext;
    readonly nextId: () => string;
  },
) {
  if (
    value.kind !== 'payment' ||
    value.state.kind !== 'owed' ||
    value.state.reason !== 'refund_required' ||
    value.state.evidence.kind !== 'verified'
  )
    return value;
  const proof = value.state.evidence.payment;
  const { priceId, invoicePaymentId, ...payment } = proof;
  void priceId;
  void invoicePaymentId;
  const admitted = await admitRefundAction(tx, {
    userId: value.userId,
    closedAt: value.closedAt,
    payment,
    nextId: input.nextId,
  });
  if (admitted.kind === 'conflict') {
    const now = (await readDatabaseTime(tx)).toISOString();
    return persistClassification(
      tx,
      value,
      retainRefundAdmissionConflict(value, { ...input.context, now }),
    );
  }
  if (!('action' in admitted)) return value;
  const now = (await readDatabaseTime(tx)).toISOString();
  return persistClassification(
    tx,
    value,
    classifyPaymentObservation(
      value,
      proof,
      { ...input.context, now },
      admitted.action,
    ),
  );
}
async function persistClassification(
  tx: BoundedTransactionContext,
  value: BillingPaymentObservation,
  linked: ReturnType<typeof classifyPaymentObservation>,
) {
  if (linked.kind !== 'recorded' || linked.observation.kind !== 'payment')
    throw createAppError('CONFLICT');
  await tx
    .update(billingPaymentObservations)
    .set({
      state: linked.observation.state,
      refundActionId: linked.observation.refundActionId,
      observedAt: new Date(linked.observation.observedAt),
    })
    .where(eq(billingPaymentObservations.id, value.id));
  return linked.observation;
}
