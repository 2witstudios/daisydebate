import { eq } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import {
  advanceBillingSync,
  billingSyncStateSchema,
  subscriptionEvidenceSchema,
  type Purchase,
} from '@daisy/protocol/billing';
import type { BoundedTransactionContext } from './transaction-context';
import { billingCustomers } from './schema/billing-customers';
import { billingSubscriptions } from './schema/billing-subscriptions';

function matchingCustomer(
  customer: typeof billingCustomers.$inferSelect | undefined,
  mode: Purchase['mode'],
  customerId: string,
) {
  return (
    !customer ||
    (customer.closedAt === null &&
      customer.mode === mode &&
      customer.vendorCustomerId === customerId)
  );
}

export function permitsNewSubscription(
  row: typeof billingSubscriptions.$inferSelect | undefined,
) {
  if (!row) return true;
  const evidence = subscriptionEvidenceSchema.safeParse(row.evidence);
  if (!evidence.success) throw createAppError('VALIDATION');
  return ['canceled', 'incomplete_expired'].includes(evidence.data.lifecycle);
}

/** A verified completed Session establishes identity, never paid evidence or grants. */
export async function completePurchaseMapping(input: {
  readonly tx: BoundedTransactionContext;
  readonly purchase: Purchase;
  readonly customer: typeof billingCustomers.$inferSelect | undefined;
  readonly subscription: typeof billingSubscriptions.$inferSelect | undefined;
  readonly now: string;
  readonly nextId: () => string;
}) {
  const { tx, purchase, customer, subscription, now, nextId } = input;
  const { state } = purchase;
  if (state.kind !== 'complete') throw createAppError('VALIDATION');
  if (!matchingCustomer(customer, purchase.mode, state.customerId))
    throw createAppError('CONFLICT');
  if (subscription?.vendorSubscriptionId === state.subscriptionId) return;
  if (!permitsNewSubscription(subscription)) throw createAppError('CONFLICT');
  const notified = advanceBillingSync(
    customer ? billingSyncStateSchema.parse(customer.synchronization) : null,
    { kind: 'notify', newReceipt: true },
    now,
  );
  if (notified.kind !== 'changed') throw createAppError('CONFLICT');
  if (customer) {
    await tx
      .update(billingCustomers)
      .set({ synchronization: notified.state })
      .where(eq(billingCustomers.id, customer.id));
  } else {
    await tx.insert(billingCustomers).values({
      id: nextId(),
      userId: purchase.userId,
      vendorCustomerId: state.customerId,
      mode: purchase.mode,
      synchronization: notified.state,
      createdAt: new Date(now),
    });
  }
  if (subscription)
    await tx
      .update(billingSubscriptions)
      .set({ current: false })
      .where(eq(billingSubscriptions.id, subscription.id));
  await tx.insert(billingSubscriptions).values({
    id: nextId(),
    userId: purchase.userId,
    vendorSubscriptionId: state.subscriptionId,
    evidence: { lifecycle: 'incomplete', settlement: { kind: 'unpaid' } },
    current: true,
    observedAt: new Date(now),
    createdAt: new Date(now),
  });
}
