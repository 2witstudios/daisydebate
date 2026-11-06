import { and, asc, eq, gt } from 'drizzle-orm';
import { idSchema } from '@daisy/protocol';
import {
  billingPaymentObservationSchema,
  cleanupWorkSchema,
  ownsCleanupClaim,
  type CleanupWork,
} from '@daisy/protocol/billing';
import type { BoundedTransaction } from './bounded-transaction';
import { lockCleanupJob, cleanupContext } from './billing-cleanup-authority';
import { billingPaymentObservations } from './schema/billing-payment-observations';

const refuse = { kind: 'refuse' } as const;
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

/** Bounded retained-resource reads share the existing privacy job's current authority. */
export function createBillingPaymentObservations(run: BoundedTransaction) {
  return {
    observations(
      jobId: string,
      claimId: string,
      work: CleanupWork,
      afterId: string | null,
    ) {
      return run(async (tx) => {
        const parsed = cleanupWorkSchema.safeParse(work);
        if (
          !parsed.success ||
          (afterId !== null && !idSchema.safeParse(afterId).success)
        )
          return refuse;
        const locked = await lockCleanupJob(tx, jobId);
        if (!locked?.state) return refuse;
        const rows = await tx
          .select()
          .from(billingPaymentObservations)
          .where(
            and(
              eq(billingPaymentObservations.userId, locked.userId),
              ...(afterId === null
                ? []
                : [gt(billingPaymentObservations.id, afterId)]),
            ),
          )
          .orderBy(asc(billingPaymentObservations.id))
          .limit(21);
        const context = await cleanupContext(tx, jobId, undefined);
        if (!ownsCleanupClaim(locked.state, claimId, parsed.data, context))
          return refuse;
        return {
          kind: 'observations' as const,
          observations: rows.slice(0, 20).map(paymentObservationFromRow),
          more: rows.length > 20,
        };
      });
    },
  };
}
