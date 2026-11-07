import { and, eq, sql } from 'drizzle-orm';
import type { BoundedTransactionContext } from './transaction-context';
import { billingPurchases } from './schema/billing-purchases';
import { purchaseFromRow } from './billing-purchase-authority';

/** Read under the caller's canonical account fence; no current configuration can replace this original offer. */
export async function readFrozenBillingOffer(
  tx: BoundedTransactionContext,
  identity: {
    readonly userId: string;
    readonly mode: 'test' | 'live';
    readonly customerId: string;
    readonly vendorSubscriptionId: string;
  },
) {
  const rows = await tx
    .select()
    .from(billingPurchases)
    .where(
      and(
        eq(billingPurchases.userId, identity.userId),
        eq(billingPurchases.mode, identity.mode),
        sql`${billingPurchases.state}->>'kind'='complete'`,
        sql`${billingPurchases.state}->>'customerId'=${identity.customerId}`,
        sql`${billingPurchases.state}->>'subscriptionId'=${identity.vendorSubscriptionId}`,
      ),
    )
    .limit(2);
  if (rows.length !== 1) return null;
  const purchase = purchaseFromRow(rows[0]!);
  if (purchase.state.kind !== 'complete') return null;
  return {
    kind: 'purchase' as const,
    purchaseId: purchase.id,
    vendorSubscriptionId: purchase.state.subscriptionId,
    priceId: purchase.priceId,
    admittedAt: purchase.admittedAt,
  };
}
