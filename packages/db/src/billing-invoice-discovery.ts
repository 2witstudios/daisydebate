import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import {
  advanceCleanup,
  cleanupWorkSchema,
  ownedInvoiceObservationSchema,
  ownsCleanupClaim,
  type CleanupWork,
} from '@daisy/protocol/billing';
import type { BoundedTransaction } from './bounded-transaction';
import {
  lockCleanupJob,
  cleanupFacts,
  cleanupContext,
} from './billing-cleanup-authority';
import {
  retainInvoiceWitness,
  rearmInvoiceWitness,
} from './billing-invoice-observation';
import { privacyJobs } from './schema/privacy-jobs';

const pageSchema = z
  .strictObject({
    reads: z.array(ownedInvoiceObservationSchema).max(20),
    more: z.boolean(),
  })
  .refine(
    (value) =>
      !(value.more && value.reads.length === 0) &&
      new Set(value.reads.map((read) => read.invoiceId)).size ===
        value.reads.length &&
      value.reads.every((read) => read.source.kind === 'unresolved'),
  );

/** An observed invoice identity becomes a durable owed witness before its page cursor can move. */
export function createBillingInvoiceDiscovery(input: {
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
}) {
  return {
    retainInvoicePage(
      jobId: string,
      claimId: string,
      work: CleanupWork,
      value: unknown,
    ) {
      const page = pageSchema.safeParse(value),
        selected = cleanupWorkSchema.safeParse(work);
      if (
        !page.success ||
        !selected.success ||
        selected.data.kind !== 'scan' ||
        selected.data.lane !== 'invoices' ||
        selected.data.scan.kind !== 'page'
      )
        return Promise.resolve('idle' as const);
      const request = selected.data;
      const afterId = selected.data.scan.afterId;
      return input.run(async (tx) => {
        const locked = await lockCleanupJob(tx, jobId);
        if (!locked?.state) return 'idle' as const;
        const state = locked.state,
          facts = await cleanupFacts(tx, locked.userId);
        if (
          facts.route.kind !== 'owned' ||
          page.data.reads.some(
            (read) =>
              read.mode !== facts.route.mode ||
              read.customerId !== facts.route.customerId ||
              read.invoiceId === afterId,
          )
        )
          return 'idle' as const;
        const context = await cleanupContext(tx, jobId, facts.effects);
        if (!ownsCleanupClaim(state, claimId, request, context))
          return 'idle' as const;
        for (const read of page.data.reads) {
          const witness = await retainInvoiceWitness(tx, {
            read,
            context: {
              userId: locked.userId,
              closedAt: locked.closedAt,
              now: context.now,
            },
            nextId: input.nextId,
          });
          await rearmInvoiceWitness(tx, witness);
        }
        const current = await cleanupFacts(tx, locked.userId);
        const finalContext = await cleanupContext(tx, jobId, current.effects);
        const transition = advanceCleanup(
          state,
          {
            kind: 'page',
            claimId,
            work: request,
            ids: page.data.reads.map((read) => read.invoiceId),
            more: page.data.more,
          },
          finalContext,
        );
        if (
          transition.kind !== 'progress' ||
          transition.state.kind === 'acknowledged'
        )
          throw createAppError('CONFLICT');
        await tx
          .update(privacyJobs)
          .set({
            billingCleanup: transition.state,
            retryAt: new Date(transition.state.retryAt),
          })
          .where(eq(privacyJobs.id, jobId));
        return 'progress' as const;
      });
    },
  };
}
