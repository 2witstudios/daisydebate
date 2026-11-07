import { and, eq } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import {
  closurePaymentDisposition,
  refundActionSchema,
  type RefundAction,
} from '@daisy/protocol/billing';
import type { BoundedTransactionContext } from './transaction-context';
import { readDatabaseTime } from './database-clock';
import {
  refundFromRow,
  requireRefundCustomer,
} from './billing-refund-authority';
import { billingRefundActions } from './schema/billing-refund-actions';
export type RefundPayment = Pick<
  RefundAction,
  | 'mode'
  | 'customerId'
  | 'chargeId'
  | 'invoiceId'
  | 'vendorSubscriptionId'
  | 'amountMinor'
  | 'currency'
  | 'period'
  | 'paidAtSeconds'
>;
function originalPayment(action: RefundAction): RefundPayment {
  return {
    mode: action.mode,
    customerId: action.customerId,
    chargeId: action.chargeId,
    invoiceId: action.invoiceId,
    vendorSubscriptionId: action.vendorSubscriptionId,
    amountMinor: action.amountMinor,
    currency: action.currency,
    period: action.period,
    paidAtSeconds: action.paidAtSeconds,
  };
}
function samePayment(action: RefundAction, other: RefundAction) {
  return (
    action.userId === other.userId &&
    action.closedAt === other.closedAt &&
    JSON.stringify(originalPayment(action)) ===
      JSON.stringify(originalPayment(other))
  );
}

/** The caller owns canonical closed-account authority and atomically schedules any newly owed cleanup. */
export async function admitRefundAction(
  tx: BoundedTransactionContext,
  input: {
    readonly userId: string;
    readonly closedAt: string;
    readonly payment: RefundPayment;
    readonly nextId: () => string;
  },
) {
  const { userId, closedAt, payment } = input;
  await requireRefundCustomer(tx, userId, payment.mode, payment.customerId);
  const now = (await readDatabaseTime(tx)).toISOString();
  const disposition = closurePaymentDisposition({
    closedAt,
    paidAtSeconds: payment.paidAtSeconds,
    now,
  });
  if (disposition !== 'refund') return { kind: disposition };
  const action = refundActionSchema.parse({
    ...payment,
    id: input.nextId(),
    userId,
    closedAt,
    admittedAt: now,
    state: { kind: 'ready' },
    claim: null,
  });
  const inserted = await tx
    .insert(billingRefundActions)
    .values({
      id: action.id,
      userId,
      mode: action.mode,
      vendorCustomerId: action.customerId,
      vendorChargeId: action.chargeId,
      vendorInvoiceId: action.invoiceId,
      vendorSubscriptionId: action.vendorSubscriptionId,
      amountMinor: action.amountMinor,
      currency: action.currency,
      periodStartsAt: new Date(action.period.startsAt),
      periodEndsAt: new Date(action.period.endsAt),
      closedAt: new Date(closedAt),
      paidAtSeconds: action.paidAtSeconds,
      admittedAt: new Date(now),
      state: action.state,
      claim: null,
    })
    .onConflictDoNothing({
      target: [billingRefundActions.mode, billingRefundActions.vendorChargeId],
    })
    .returning();
  const [row] = await tx
    .select()
    .from(billingRefundActions)
    .where(
      and(
        eq(billingRefundActions.mode, action.mode),
        eq(billingRefundActions.vendorChargeId, action.chargeId),
      ),
    )
    .for('update');
  if (!row) throw createAppError('CONFLICT');
  const stored = refundFromRow(row);
  if (!samePayment(stored, action)) return { kind: 'conflict' } as const;
  if (inserted.length === 0)
    return { kind: 'existing' as const, action: stored };
  return { kind: 'admitted' as const, action: stored };
}
