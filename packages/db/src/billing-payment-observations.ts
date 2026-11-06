import { and, asc, eq, gt } from 'drizzle-orm';
import { idSchema } from '@daisy/protocol';
import {
  cleanupWorkSchema,
  ownsCleanupClaim,
  ownedInvoiceObservationSchema,
  advanceCleanup,
  type CleanupWork,
  type OwnedInvoiceObservation,
} from '@daisy/protocol/billing';
import type { BoundedTransaction } from './bounded-transaction';
import { lockCleanupJob, cleanupContext } from './billing-cleanup-authority';
import { billingPaymentObservations } from './schema/billing-payment-observations';
import { paymentObservationFromRow } from './billing-payment-observation-record';
import { retainInvoiceWitness } from './billing-invoice-observation';
import { createAppError } from '@daisy/errors';
import { cleanupFacts } from './billing-cleanup-authority';
import { privacyJobs } from './schema/privacy-jobs';

const refuse = { kind: 'refuse' } as const;
/** Retained-resource reads and atomic progress share the existing privacy job's current authority. */
export function createBillingPaymentObservations(input: {
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
}) {
  return {
    retainInvoice(
      jobId: string,
      claimId: string,
      work: CleanupWork,
      read: unknown,
    ) {
      return input.run(async (tx) => {
        const request = invoiceRetentionRequest(work, read);
        if (!request) return 'idle' as const;
        const locked = await lockCleanupJob(tx, jobId);
        if (!locked?.state) return 'idle' as const;
        const facts = await cleanupFacts(tx, locked.userId);
        if (!matchesInvoiceRoute(facts.route, request.read))
          return 'idle' as const;
        const before = await cleanupContext(tx, jobId, facts.effects);
        if (!ownsCleanupClaim(locked.state, claimId, request.work, before))
          return 'idle' as const;
        const observation = await retainInvoiceWitness(tx, {
          read: request.read,
          context: {
            userId: locked.userId,
            closedAt: locked.closedAt,
            now: before.now,
          },
          nextId: input.nextId,
        });
        const currentFacts = await cleanupFacts(tx, locked.userId);
        const context = await cleanupContext(tx, jobId, currentFacts.effects);
        const transition = advanceCleanup(
          locked.state,
          {
            kind: 'retained',
            claimId,
            work: request.work,
            observation,
          },
          {
            ...context,
            observationOwner: {
              userId: locked.userId,
              closedAt: locked.closedAt,
            },
          },
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
    observations(
      jobId: string,
      claimId: string,
      work: CleanupWork,
      afterId: string | null,
    ) {
      return input.run(async (tx) => {
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

function invoiceRetentionRequest(work: CleanupWork, read: unknown) {
  const parsed = ownedInvoiceObservationSchema.safeParse(read),
    selected = cleanupWorkSchema.safeParse(work);
  if (
    !parsed.success ||
    !selected.success ||
    selected.data.kind !== 'scan' ||
    selected.data.lane !== 'invoices' ||
    selected.data.scan.kind !== 'selected' ||
    selected.data.scan.id !== parsed.data.invoiceId
  )
    return null;
  return { read: parsed.data, work: selected.data };
}
function matchesInvoiceRoute(
  route: Awaited<ReturnType<typeof cleanupFacts>>['route'],
  read: OwnedInvoiceObservation,
) {
  return (
    route.kind === 'owned' &&
    route.mode === read.mode &&
    route.customerId === read.customerId
  );
}
