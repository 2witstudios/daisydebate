import { and, asc, eq, gt } from 'drizzle-orm';
import {
  cleanupWorkSchema,
  ownsCleanupClaim,
  type CleanupWork,
  type CleanupEvent,
} from '@daisy/protocol/billing';
import type { BoundedTransaction } from './bounded-transaction';
import type { BoundedTransactionContext } from './transaction-context';
import { lockCleanupJob, cleanupContext } from './billing-cleanup-authority';
import { billingPurchases } from './schema/billing-purchases';
import { billingRefundActions } from './schema/billing-refund-actions';
import { purchaseFromRow } from './billing-purchase-authority';
import { refundFromRow } from './billing-refund-authority';
const refuse = { kind: 'refuse' } as const;
type LocalWork = Extract<CleanupWork, { kind: 'scan' }>;

/** Positive local terminal facts are re-read under the caller's canonical account/job fence. */
export async function currentCleanupResolution(
  tx: BoundedTransactionContext,
  userId: string,
  event: Extract<CleanupEvent, { kind: 'resolved' }>,
) {
  const work = cleanupWorkSchema.safeParse(event.work);
  if (
    !work.success ||
    work.data.kind !== 'scan' ||
    work.data.scan.kind !== 'selected'
  )
    return false;
  if (work.data.lane !== 'purchases' && work.data.lane !== 'refunds')
    return true;
  const resource = await readResources(tx, userId, work.data);
  if (resource.kind === 'refund')
    return (
      resource.action.state.kind === 'known' &&
      resource.action.state.status === 'succeeded'
    );
  return (
    resource.kind === 'purchase' &&
    ['complete', 'expired', 'abandoned'].includes(resource.purchase.state.kind)
  );
}
async function readResources(
  tx: BoundedTransactionContext,
  userId: string,
  work: LocalWork,
) {
  const scan = work.scan;
  if (scan.kind === 'page') {
    const table =
      work.lane === 'purchases' ? billingPurchases : billingRefundActions;
    const rows = await tx
      .select({ id: table.id })
      .from(table)
      .where(
        and(
          eq(table.userId, userId),
          ...(scan.afterId === null ? [] : [gt(table.id, scan.afterId)]),
        ),
      )
      .orderBy(asc(table.id))
      .limit(21);
    return {
      kind: 'page' as const,
      ids: rows.slice(0, 20).map((row) => row.id),
      more: rows.length > 20,
    };
  }
  if (scan.kind !== 'selected') return refuse;
  if (work.lane === 'purchases') {
    const [row] = await tx
      .select()
      .from(billingPurchases)
      .where(
        and(
          eq(billingPurchases.userId, userId),
          eq(billingPurchases.id, scan.id),
        ),
      );
    return row
      ? { kind: 'purchase' as const, purchase: purchaseFromRow(row) }
      : refuse;
  }
  const [row] = await tx
    .select()
    .from(billingRefundActions)
    .where(
      and(
        eq(billingRefundActions.userId, userId),
        eq(billingRefundActions.id, scan.id),
      ),
    );
  return row ? { kind: 'refund' as const, action: refundFromRow(row) } : refuse;
}
/** Reads only the selected job's sponsor; caller cannot supply another account or a current-price substitute. */
export function createBillingCleanupResources(run: BoundedTransaction) {
  return {
    resources(jobId: string, claimId: string, work: CleanupWork) {
      return run(async (tx) => {
        const parsed = cleanupWorkSchema.safeParse(work);
        if (
          !parsed.success ||
          parsed.data.kind !== 'scan' ||
          !['purchases', 'refunds'].includes(parsed.data.lane)
        )
          return refuse;
        const locked = await lockCleanupJob(tx, jobId);
        if (!locked?.state) return refuse;
        const resource = await readResources(tx, locked.userId, parsed.data);
        // Query waits precede the authority instant; a stale read is never handed to vendor delivery.
        const context = await cleanupContext(tx, jobId, undefined);
        return ownsCleanupClaim(locked.state, claimId, parsed.data, context)
          ? resource
          : refuse;
      });
    },
  };
}
