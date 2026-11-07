import { and, asc, eq, gt, sql } from 'drizzle-orm';
import { nextPurchaseWork } from '@daisy/protocol/billing';
import type { BoundedTransaction } from './bounded-transaction';
import { checkBillingPage, type BillingPage } from './billing-pagination';
import { lockPurchaseId } from './billing-purchase-authority';
import { billingPurchases } from './schema/billing-purchases';

/** The injected current-service transaction fences both sides of every account lock wait. */
export function createBillingPurchaseDiscovery(run: BoundedTransaction) {
  return {
    purchases(input: BillingPage) {
      checkBillingPage(input);
      return run(async (tx) => {
        const rows = await tx
          .select({ purchaseId: billingPurchases.id })
          .from(billingPurchases)
          .where(
            and(
              eq(billingPurchases.mode, input.mode),
              sql`${billingPurchases.state}->>'kind' in ('creating','unknown','open','complete')`,
              ...(input.afterId === undefined
                ? []
                : [gt(billingPurchases.id, input.afterId)]),
            ),
          )
          .orderBy(asc(billingPurchases.id))
          .limit(input.limit);
        return {
          rows,
          afterId: rows.at(-1)?.purchaseId ?? null,
          exhausted: rows.length < input.limit,
        };
      });
    },
    inspect(purchaseId: string) {
      return run(async (tx) => {
        const locked = await lockPurchaseId(tx, purchaseId);
        if (!locked) return null;
        const { purchase, context, closedAt } = locked;
        const work = nextPurchaseWork(purchase, context);
        // Recovery scans never issue creation claims; a member's explicit operation owns those.
        return {
          purchase,
          context,
          closedAt,
          work: work === 'create' ? ('wait' as const) : work,
        };
      });
    },
  };
}
