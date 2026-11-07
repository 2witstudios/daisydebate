import { and, eq } from 'drizzle-orm';
import { z } from 'zod';
import { idSchema } from '@daisy/protocol';
import type { BoundedTransactionContext } from './transaction-context';
import { billingRefundActions } from './schema/billing-refund-actions';
import { lockRefundAction } from './billing-refund-authority';

const reference = (prefix: string) =>
  z
    .string()
    .regex(new RegExp(`^${prefix}_[A-Za-z0-9_]+$`))
    .max(255);
export const refundReceiptTarget = z.strictObject({
  id: reference('re'),
  chargeId: reference('ch'),
  customerId: reference('cus').nullable(),
  actionId: idSchema.nullable(),
});

/** Signed refund events only wake reconciliation of an already owned action; they never settle it. */
export async function resolveRefundReceipt(
  tx: BoundedTransactionContext,
  mode: 'test' | 'live',
  refund: z.infer<typeof refundReceiptTarget>,
) {
  const [selector] = await tx
    .select({ id: billingRefundActions.id })
    .from(billingRefundActions)
    .where(
      and(
        eq(billingRefundActions.mode, mode),
        eq(billingRefundActions.vendorChargeId, refund.chargeId),
      ),
    )
    .limit(1);
  if (!selector) return null;
  const action = await lockRefundAction(tx, selector.id);
  if (
    !action ||
    (refund.customerId !== null && refund.customerId !== action.customerId) ||
    (refund.actionId !== null && refund.actionId !== action.id)
  )
    return null;
  if (
    action.state.kind === 'known'
      ? action.state.refundId !== refund.id
      : refund.actionId !== action.id
  )
    return null;
  return action.customerId;
}
