import { eq, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import {
  advanceCleanup,
  cleanupWork,
  startCleanup,
  ownsCleanupClaim,
  paymentObservationSourceSchema,
  type CleanupEvent,
  type CleanupWork,
} from '@daisy/protocol/billing';
import type { BoundedTransaction } from './bounded-transaction';
import { createBillingCleanupResources } from './billing-cleanup-resources';
import { createBillingPaymentObservations } from './billing-payment-observations';
import { privacyJobs } from './schema/privacy-jobs';
import {
  cleanupContext,
  cleanupFacts,
  lockCleanupJob,
} from './billing-cleanup-authority';

/** Stripe alone consumes its typed execution state and queue outcome in this current-service transaction. */
export function createBillingCleanup(input: {
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
}) {
  return {
    ...createBillingCleanupResources(input.run),
    ...createBillingPaymentObservations(input.run),
    frozenOffer(
      jobId: string,
      claimId: string,
      work: CleanupWork,
      vendorSubscriptionId: string,
    ) {
      return input.run(async (tx) => {
        const locked = await lockCleanupJob(tx, jobId);
        if (
          !locked?.state ||
          !/^sub_[A-Za-z0-9_]{1,251}$/.test(vendorSubscriptionId)
        )
          return { kind: 'unresolved' } as const;
        const facts = await cleanupFacts(tx, locked.userId);
        if (facts.route.kind !== 'owned')
          return { kind: 'unresolved' } as const;
        const rows =
          await tx.execute(sql`select id,admitted_at as "admittedAt",price_id as "priceId",mode,state->>'customerId' as "customerId",state->>'subscriptionId' as "vendorSubscriptionId"
          from billing_purchases where user_id=${locked.userId} and mode=${facts.route.mode}
          and state->>'kind'='complete' and state->>'customerId'=${facts.route.customerId}
          and state->>'subscriptionId'=${vendorSubscriptionId} limit 2`);
        const row = rows[0];
        const context = await cleanupContext(tx, jobId, facts.effects);
        if (
          !ownsCleanupClaim(locked.state, claimId, work, context) ||
          rows.length !== 1
        )
          return { kind: 'unresolved' } as const;
        const source = readOriginalOffer(
          row,
          vendorSubscriptionId,
          locked.closedAt,
        );
        if (!source) return { kind: 'unresolved' } as const;
        return {
          kind: 'owned' as const,
          source,
          owner: {
            mode: facts.route.mode,
            customerId: facts.route.customerId,
            priceId: source.priceId,
            vendorSubscriptionId,
          },
        };
      });
    },
    claim(jobId: string) {
      return input.run(async (tx) => {
        const locked = await lockCleanupJob(tx, jobId);
        if (!locked) return { kind: 'idle' } as const;
        const facts = await cleanupFacts(tx, locked.userId);
        const context = await cleanupContext(tx, jobId, facts.effects);
        if (Date.parse(context.now) < locked.row.retryAt.getTime())
          return { kind: 'idle' } as const;
        const state =
          locked.state ?? startCleanup(jobId, locked.row.retryAt.toISOString());
        if (!state) throw createAppError('INVARIANT');
        const transition = advanceCleanup(
          state,
          { kind: 'claim', claimId: input.nextId() },
          context,
        );
        if (transition.kind !== 'claimed') return { kind: 'idle' } as const;
        await tx
          .update(privacyJobs)
          .set({ billingCleanup: transition.state })
          .where(eq(privacyJobs.id, jobId));
        return {
          kind: 'claimed' as const,
          state: transition.state,
          work: cleanupWork(transition.state)!,
          userId: locked.userId,
          closedAt: locked.closedAt,
          facts,
        };
      });
    },
    record(jobId: string, event: Exclude<CleanupEvent, { kind: 'claim' }>) {
      return input.run(async (tx) => {
        const locked = await lockCleanupJob(tx, jobId);
        if (!locked?.state) return 'idle' as const;
        const facts = await cleanupFacts(tx, locked.userId);
        const context = await cleanupContext(tx, jobId, facts.effects);
        const transition = advanceCleanup(locked.state, event, context);
        if (transition.kind === 'idle' || transition.kind === 'claimed')
          return 'idle' as const;
        const state = transition.state;
        if (state.kind === 'acknowledged') {
          await tx
            .update(privacyJobs)
            .set({
              billingCleanup: state,
              status: 'succeeded',
              succeededAt: new Date(state.checkedAt),
            })
            .where(eq(privacyJobs.id, jobId));
          return 'complete' as const;
        }
        await tx
          .update(privacyJobs)
          .set({
            billingCleanup: state,
            retryAt: new Date(state.retryAt),
            attempts:
              locked.row.attempts + (transition.kind === 'failure' ? 1 : 0),
          })
          .where(eq(privacyJobs.id, jobId));
        return transition.kind;
      });
    },
  };
}

function readOriginalOffer(
  row: Record<string, unknown> | undefined,
  vendorSubscriptionId: string,
  closedAt: string,
) {
  if (!row) return null;
  const source = paymentObservationSourceSchema.safeParse({
    kind: 'purchase',
    purchaseId: row.id,
    vendorSubscriptionId,
    priceId: row.priceId,
    admittedAt:
      row.admittedAt instanceof Date ? row.admittedAt.toISOString() : null,
  });
  return source.success &&
    source.data.kind === 'purchase' &&
    Date.parse(source.data.admittedAt) <= Date.parse(closedAt)
    ? source.data
    : null;
}
