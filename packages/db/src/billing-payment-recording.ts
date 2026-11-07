import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import {
  ownedPaymentObservationSchema,
  type OwnedPaymentObservation,
} from '@daisy/protocol/billing';
import type { BoundedTransaction } from './bounded-transaction';
import {
  lockRefundAccount,
  requireRefundCustomer,
} from './billing-refund-authority';
import { privacyJobs } from './schema/privacy-jobs';
import { writePaymentObservation } from './billing-payment-observation-write';
import { readDatabaseTime } from './database-clock';
import { enqueuePrivacyJob } from './privacy/enqueue-job';
const batchSchema = z
  .array(ownedPaymentObservationSchema)
  .min(1)
  .max(20)
  .refine((reads) =>
    reads.every(
      (read) =>
        read.mode === reads[0]!.mode &&
        read.customerId === reads[0]!.customerId &&
        read.invoiceId === reads[0]!.invoiceId,
    ),
  );

/** Late verified facts use current account authority; one complete bounded read rotates the cleanup job at most once. */
export function createBillingPaymentRecording(input: {
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
}) {
  const record = async (
    userId: string,
    reads: readonly OwnedPaymentObservation[],
  ) => {
    const refused = createAppError('VALIDATION');
    try {
      return await input.run(async (tx) => {
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
        const owner = reads[0]!;
        await requireRefundCustomer(tx, userId, owner.mode, owner.customerId);
        let changed = false;
        for (const read of reads) {
          const result = await writePaymentObservation(tx, {
            read,
            context: {
              userId,
              closedAt,
              now: (await readDatabaseTime(tx)).toISOString(),
            },
            nextId: input.nextId,
          });
          if (result.kind === 'refuse') throw refused;
          if (result.kind === 'recorded') changed = true;
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
    } catch (error) {
      // Only this invocation's explicit validation refusal after CONFIRMED rollback is ordinary refusal.
      // A lost rollback/commit reply or unrelated DB/service failure must propagate as uncertainty.
      if (error === refused) return 'refuse' as const;
      throw error;
    }
  };
  return {
    recordPayment(userId: string, read: unknown) {
      const parsed = ownedPaymentObservationSchema.safeParse(read);
      return parsed.success
        ? record(userId, [parsed.data])
        : Promise.resolve('refuse' as const);
    },
    recordPayments(userId: string, value: unknown) {
      const parsed = batchSchema.safeParse(value);
      return parsed.success
        ? record(userId, parsed.data)
        : Promise.resolve('refuse' as const);
    },
  };
}
