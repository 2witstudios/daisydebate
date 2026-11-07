import { and, eq } from 'drizzle-orm';
import {
  subscriptionEvidenceSchema,
  type SubscriptionEvidence,
} from '@daisy/protocol/billing';
import type { BoundedTransactionContext } from './transaction-context';
import { billingSubscriptions } from './schema/billing-subscriptions';

/** Same canonical account fence as synchronization and admission; no cached access snapshot. */
export async function readBillingEvidence(
  tx: Pick<BoundedTransactionContext, 'select'>,
  userId: string,
): Promise<SubscriptionEvidence | null> {
  const [row] = await tx
    .select({ evidence: billingSubscriptions.evidence })
    .from(billingSubscriptions)
    .where(
      and(
        eq(billingSubscriptions.userId, userId),
        eq(billingSubscriptions.current, true),
      ),
    )
    .limit(1);
  return row ? subscriptionEvidenceSchema.parse(row.evidence) : null;
}
