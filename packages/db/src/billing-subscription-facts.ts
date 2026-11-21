import { and, eq } from 'drizzle-orm';
import {
  subscriptionEvidenceSchema,
  type SubscriptionEvidence,
} from '@daisy/protocol/billing';
import { billingSubscriptions } from './schema/billing-subscriptions';
import type { Tx } from './tx';

/** Same canonical account fence as synchronization and admission; no cached access snapshot. */
export async function readBillingEvidence(
  tx: Tx,
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
