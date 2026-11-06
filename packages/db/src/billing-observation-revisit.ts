import { and, eq } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import {
  cleanupWorkSchema,
  ownedPaymentObservationSchema,
  ownsCleanupClaim,
  type CleanupWork,
} from '@daisy/protocol/billing';
import type { BoundedTransaction } from './bounded-transaction';
import type { BoundedTransactionContext } from './transaction-context';
import { lockCleanupJob, cleanupContext } from './billing-cleanup-authority';
import { billingPaymentObservations } from './schema/billing-payment-observations';
import { paymentObservationFromRow } from './billing-payment-observation-record';
import { writePaymentObservation } from './billing-payment-observation-write';
import { requireRefundCustomer } from './billing-refund-authority';
import { commitObservationProgress } from './billing-observation-progress';

async function lockSelectedObservation(
  tx: BoundedTransactionContext,
  jobId: string,
  claimId: string,
  work: CleanupWork,
) {
  const parsed = cleanupWorkSchema.safeParse(work);
  if (
    !parsed.success ||
    parsed.data.kind !== 'scan' ||
    parsed.data.lane !== 'observations' ||
    parsed.data.scan.kind !== 'selected'
  )
    return null;
  const locked = await lockCleanupJob(tx, jobId);
  if (!locked?.state) return null;
  const state = locked.state;
  const [row] = await tx
    .select()
    .from(billingPaymentObservations)
    .where(
      and(
        eq(billingPaymentObservations.userId, locked.userId),
        eq(billingPaymentObservations.id, parsed.data.scan.id),
      ),
    )
    .for('update');
  const context = await cleanupContext(tx, jobId, undefined);
  if (!row || !ownsCleanupClaim(state, claimId, parsed.data, context))
    return null;
  return {
    locked,
    state,
    work: parsed.data,
    observation: paymentObservationFromRow(row),
    now: context.now,
  };
}

/** Exact selected reads stay bounded beyond the first page; fresh facts and their consumed remainder commit together. */
export function createBillingObservationRevisit(input: {
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
}) {
  return {
    selectedObservation(jobId: string, claimId: string, work: CleanupWork) {
      return input.run(async (tx) => {
        const selected = await lockSelectedObservation(
          tx,
          jobId,
          claimId,
          work,
        );
        return selected
          ? { kind: 'observation' as const, observation: selected.observation }
          : { kind: 'refuse' as const };
      });
    },
    revisitPayment(
      jobId: string,
      claimId: string,
      work: CleanupWork,
      read: unknown,
    ) {
      const parsed = ownedPaymentObservationSchema.safeParse(read);
      if (!parsed.success) return Promise.resolve('idle' as const);
      return input.run(async (tx) => {
        const selected = await lockSelectedObservation(
          tx,
          jobId,
          claimId,
          work,
        );
        if (!selected || selected.observation.kind !== 'payment')
          return 'idle' as const;
        const { observation, locked } = selected;
        if (
          observation.mode !== parsed.data.mode ||
          observation.customerId !== parsed.data.customerId ||
          observation.invoiceId !== parsed.data.invoiceId ||
          observation.invoicePaymentId !== parsed.data.invoicePaymentId
        )
          return 'idle' as const;
        await requireRefundCustomer(
          tx,
          locked.userId,
          parsed.data.mode,
          parsed.data.customerId,
        );
        const result = await writePaymentObservation(tx, {
          read: parsed.data,
          context: {
            userId: locked.userId,
            closedAt: locked.closedAt,
            now: selected.now,
          },
          nextId: input.nextId,
        });
        if (result.kind === 'refuse') return 'idle' as const;
        if (result.observation.id !== observation.id)
          throw createAppError('CONFLICT');
        return commitObservationProgress(tx, {
          jobId,
          userId: locked.userId,
          closedAt: locked.closedAt,
          state: selected.state,
          event: {
            kind: 'retained',
            claimId,
            work: selected.work,
            observation: result.observation,
          },
        });
      });
    },
  };
}
