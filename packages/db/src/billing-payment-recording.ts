import { and, eq } from 'drizzle-orm';
import { ownedPaymentObservationSchema } from '@daisy/protocol/billing';
import type { BoundedTransaction } from './bounded-transaction';
import {
  lockRefundAccount,
  requireRefundCustomer,
} from './billing-refund-authority';
import { privacyJobs } from './schema/privacy-jobs';
import { writePaymentObservation } from './billing-payment-observation-write';
import { readDatabaseTime } from './database-clock';
import { enqueuePrivacyJob } from './privacy/enqueue-job';

/** Late verified reads have no stale cleanup-token authority; changed knowledge reopens the current job atomically. */
export function createBillingPaymentRecording(input: {
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
}) {
  return {
    recordPayment(userId: string, read: unknown) {
      const parsed = ownedPaymentObservationSchema.safeParse(read);
      if (!parsed.success) return Promise.resolve('refuse' as const);
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
        await requireRefundCustomer(
          tx,
          userId,
          parsed.data.mode,
          parsed.data.customerId,
        );
        const now = (await readDatabaseTime(tx)).toISOString();
        const result = await writePaymentObservation(tx, {
          read: parsed.data,
          context: { userId, closedAt, now },
          nextId: input.nextId,
        });
        if (result.kind !== 'recorded') return result.kind;
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
