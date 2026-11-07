import { eq } from 'drizzle-orm';
import {
  retainInvoiceStep,
  type CleanupInvoiceRequest,
} from './billing-invoice-pass-retention';
import { finishInvoice } from './billing-invoice-pass-completion';
import { createAppError } from '@daisy/errors';
import {
  cleanupWorkSchema,
  advanceCleanupInvoicePass,
  type CleanupWork,
} from '@daisy/protocol/billing';
import type { BoundedTransaction } from './bounded-transaction';
import { cleanupFacts, cleanupContext } from './billing-cleanup-authority';

import { privacyJobs } from './schema/privacy-jobs';
import { lockInvoiceExecution } from './billing-invoice-pass-authority';

/** Current invoice execution and every retained fact commit together; receipts never carry money authority themselves. */
export function createBillingPaymentProgress(input: {
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
}) {
  return {
    invoicePassStep(
      jobId: string,
      claimId: string,
      work: CleanupWork,
      step: CleanupInvoiceRequest,
    ) {
      const selected = cleanupWorkSchema.safeParse(work);
      if (!selected.success) return Promise.resolve('idle' as const);
      return input.run(async (tx) => {
        const admitted = await lockInvoiceExecution(
          tx,
          jobId,
          claimId,
          selected.data,
          step,
        );
        if (!admitted) return 'idle' as const;
        const { locked, current } = admitted;
        const { step: retainedStep, witness } = await retainInvoiceStep(
          tx,
          step,
          admitted,
          input.nextId,
        );
        const finalFacts = await cleanupFacts(tx, locked.userId);
        const finalContext = {
          ...(await cleanupContext(tx, jobId, finalFacts.effects)),
          observationOwner: {
            userId: locked.userId,
            closedAt: locked.closedAt,
          },
        };
        const transition = advanceCleanupInvoicePass(
          locked.state,
          {
            claimId,
            work: selected.data,
            step: retainedStep,
            witness,
          },
          finalContext,
        );
        if (transition.kind === 'idle') throw createAppError('CONFLICT');
        const result =
          transition.kind === 'covered'
            ? await finishInvoice(tx, {
                state: locked.state,
                work: selected.data,
                claimId,
                witness,
                current,
                coverage: transition.coverage,
                context: finalContext,
              })
            : transition;
        if (result.kind !== 'progress' || result.state.kind === 'acknowledged')
          throw createAppError('CONFLICT');
        await tx
          .update(privacyJobs)
          .set({
            billingCleanup: result.state,
            retryAt: new Date(result.state.retryAt),
          })
          .where(eq(privacyJobs.id, jobId));
        return 'progress' as const;
      });
    },
  };
}
