import { z } from 'zod';
import { and, eq, inArray } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { ownedInvoiceObservationSchema } from '@daisy/protocol/billing';
import type { BoundedTransaction } from './bounded-transaction';
import {
  lockRefundAccount,
  requireRefundCustomer,
} from './billing-refund-authority';
import { readDatabaseTime } from './database-clock';
import { enqueuePrivacyJob } from './privacy/enqueue-job';
import { privacyJobs } from './schema/privacy-jobs';
import { billingPaymentObservations } from './schema/billing-payment-observations';
import { paymentObservationFromRow } from './billing-payment-observation-record';
import { retainInvoiceWitness } from './billing-invoice-observation';
const readsSchema = z
  .array(ownedInvoiceObservationSchema)
  .min(1)
  .max(20)
  .refine((reads) =>
    reads.every(
      (read) =>
        read.mode === reads[0]!.mode &&
        read.customerId === reads[0]!.customerId &&
        read.source.kind === 'unresolved',
    ),
  );

/** Late owned invoice facts outlive old execution tokens; identical knowledge never churns a healthy job. */
export function createBillingInvoiceRecording(input: {
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
}) {
  return {
    recordInvoices(userId: string, value: unknown) {
      const parsed = readsSchema.safeParse(value);
      if (!parsed.success || !idSchema.safeParse(userId).success)
        return Promise.resolve('refuse' as const);
      const reads = parsed.data,
        owner = reads[0]!;
      return input.run(async (tx) => {
        const closedAt = await lockRefundAccount(tx, userId);
        await tx
          .select({ id: privacyJobs.id })
          .from(privacyJobs)
          .where(
            and(
              eq(privacyJobs.subjectRef, userId),
              eq(privacyJobs.vendor, 'stripe'),
            ),
          )
          .for('update');
        await requireRefundCustomer(tx, userId, owner.mode, owner.customerId);
        const prior = await tx
          .select()
          .from(billingPaymentObservations)
          .where(
            and(
              eq(billingPaymentObservations.userId, userId),
              eq(billingPaymentObservations.mode, owner.mode),
              eq(billingPaymentObservations.kind, 'invoice'),
              inArray(
                billingPaymentObservations.vendorInvoiceId,
                reads.map((read) => read.invoiceId),
              ),
            ),
          )
          .for('update');
        const knowledge = new Map(
          prior.map((row) => [
            row.vendorInvoiceId,
            invoiceKnowledge(paymentObservationFromRow(row)),
          ]),
        );
        let changed = false;
        for (const read of reads) {
          const now = (await readDatabaseTime(tx)).toISOString();
          const observation = await retainInvoiceWitness(tx, {
            read,
            context: { userId, closedAt, now },
            nextId: input.nextId,
          });
          const current = invoiceKnowledge(observation);
          if (knowledge.get(read.invoiceId) !== current) changed = true;
          knowledge.set(read.invoiceId, current);
        }
        if (!changed) return 'unchanged' as const;
        await enqueuePrivacyJob(tx, {
          id: input.nextId(),
          subjectRef: userId,
          vendor: 'stripe',
          createdAt: (await readDatabaseTime(tx)).toISOString(),
        });
        return 'recorded' as const;
      });
    },
  };
}
function invoiceKnowledge(
  observation: ReturnType<typeof paymentObservationFromRow>,
) {
  if (observation.kind !== 'invoice') throw createAppError('INVARIANT');
  return JSON.stringify([observation.source, observation.state]);
}
