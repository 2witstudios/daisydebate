import { eq } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import {
  cleanupWorkSchema,
  ownedPaymentObservationSchema,
  ownsCleanupClaim,
  type CleanupWork,
} from '@daisy/protocol/billing';
import type { BoundedTransaction } from './bounded-transaction';
import {
  lockCleanupJob,
  cleanupFacts,
  cleanupContext,
} from './billing-cleanup-authority';
import { retainInvoiceWitness } from './billing-invoice-observation';
import { writePaymentObservation } from './billing-payment-observation-write';
import { commitObservationProgress } from './billing-observation-progress';
import { billingPaymentObservations } from './schema/billing-payment-observations';
import { readDatabaseTime } from './database-clock';

/** One owned payment is retained before consuming its invoice's exact durable payment cursor. */
export function createBillingPaymentProgress(input: {
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
}) {
  return {
    retainPayment(
      jobId: string,
      claimId: string,
      work: CleanupWork,
      read: unknown,
    ) {
      const parsed = paymentProgressRequest(work, read);
      if (!parsed) return Promise.resolve('idle' as const);
      return input.run(async (tx) => {
        const locked = await lockCleanupJob(tx, jobId);
        if (!locked?.state) return 'idle' as const;
        const facts = await cleanupFacts(tx, locked.userId);
        if (
          facts.route.kind !== 'owned' ||
          facts.route.mode !== parsed.read.mode ||
          facts.route.customerId !== parsed.read.customerId
        )
          return 'idle' as const;
        const before = await cleanupContext(tx, jobId, facts.effects);
        if (!ownsCleanupClaim(locked.state, claimId, parsed.work, before))
          return 'idle' as const;
        const context = {
          userId: locked.userId,
          closedAt: locked.closedAt,
          now: before.now,
        };
        await retainInvoiceWitness(tx, {
          read: {
            mode: parsed.read.mode,
            customerId: parsed.read.customerId,
            invoiceId: parsed.read.invoiceId,
            source: parsed.read.source,
          },
          context,
          nextId: input.nextId,
        });
        const retained = await writePaymentObservation(tx, {
          read: parsed.read,
          context,
          nextId: input.nextId,
        });
        if (retained.kind === 'refuse') throw createAppError('CONFLICT');
        if (retained.kind === 'unchanged')
          await tx
            .update(billingPaymentObservations)
            .set({ observedAt: await readDatabaseTime(tx) })
            .where(eq(billingPaymentObservations.id, retained.observation.id));
        return commitObservationProgress(tx, {
          jobId,
          userId: locked.userId,
          closedAt: locked.closedAt,
          state: locked.state,
          event: {
            kind: 'payments',
            claimId,
            work: parsed.work,
            beforeId: parsed.beforeId,
            afterId: parsed.read.invoicePaymentId,
            exhausted: false,
          },
        });
      });
    },
  };
}
function paymentProgressRequest(work: CleanupWork, read: unknown) {
  const selected = cleanupWorkSchema.safeParse(work),
    parsed = ownedPaymentObservationSchema.safeParse(read);
  if (!selected.success || !parsed.success) return null;
  const value = selected.data;
  if (
    value.kind !== 'scan' ||
    value.lane !== 'invoices' ||
    value.scan.kind !== 'selected' ||
    value.scan.detail.kind !== 'invoice-payments' ||
    value.scan.id !== parsed.data.invoiceId ||
    value.scan.detail.afterId === parsed.data.invoicePaymentId
  )
    return null;
  return {
    work: value,
    read: parsed.data,
    beforeId: value.scan.detail.afterId,
  };
}
