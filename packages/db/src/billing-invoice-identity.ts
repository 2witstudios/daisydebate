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
  cleanupContext,
  cleanupFacts,
  lockCleanupJob,
} from './billing-cleanup-authority';
import {
  retainInvoiceWitness,
  rearmInvoiceWitness,
} from './billing-invoice-observation';
import { privacyJobs } from './schema/privacy-jobs';

function availableInvoiceRoute(
  route: Awaited<ReturnType<typeof cleanupFacts>>['route'],
): { readonly mode: 'test' | 'live'; readonly customerId: string } | null {
  return route.kind === 'owned' &&
    (route.mode === 'test' || route.mode === 'live')
    ? { mode: route.mode, customerId: route.customerId }
    : null;
}

/** Converts retained identity debt into actual owned routing without inventing an offer or payment. */
export function createBillingInvoiceIdentity(input: {
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
}) {
  return {
    retainInvoiceIdentity(
      jobId: string,
      claimId: string,
      work: CleanupWork,
      value: unknown,
    ) {
      const parsed = cleanupWorkSchema.safeParse(work);
      const read = ownedInvoiceObservationSchema.safeParse(value);
      if (
        !parsed.success ||
        parsed.data.kind !== 'invoice-identity' ||
        !read.success ||
        read.data.invoiceId !== parsed.data.invoiceId ||
        read.data.source.kind !== 'unresolved'
      )
        return Promise.resolve('idle' as const);
      const request = parsed.data;
      return input.run(async (tx) => {
        const locked = await lockCleanupJob(tx, jobId);
        if (!locked?.state) return 'idle' as const;
        const facts = await cleanupFacts(tx, locked.userId);
        const context = await cleanupContext(tx, jobId, facts.effects);
        if (!ownsCleanupClaim(locked.state, claimId, request, context))
          return 'idle' as const;
        // Insufficient historical routing is still debt; it cannot roll back newly arrived facts.
        const route = availableInvoiceRoute(facts.route);
        if (!route) return 'route-unresolved' as const;
        if (
          read.data.mode !== route.mode ||
          read.data.customerId !== route.customerId
        )
          return 'idle' as const;
        const observation = await rearmInvoiceWitness(
          tx,
          await retainInvoiceWitness(tx, {
            read: read.data,
            context: {
              userId: locked.userId,
              closedAt: locked.closedAt,
              now: context.now,
            },
            nextId: input.nextId,
          }),
        );
        const current = await cleanupFacts(tx, locked.userId);
        const finalContext = await cleanupContext(tx, jobId, current.effects);
        const transition = advanceCleanup(
          locked.state,
          {
            kind: 'invoice-identity-retained',
            claimId,
            work: request,
            observation,
          },
          {
            ...finalContext,
            observationOwner: {
              userId: locked.userId,
              closedAt: locked.closedAt,
            },
          },
        );
        if (
          transition.kind !== 'progress' ||
          transition.state.kind !== 'scanning'
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
