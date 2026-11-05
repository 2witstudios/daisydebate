import { and, eq } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { idSchema, type EntitlementGrant } from '@daisy/protocol';
import {
  advanceBillingSync,
  reconcileSubscriptionEvidence,
  subscriptionEvidenceSchema,
  type SubscriptionEvidence,
} from '@daisy/protocol/billing';
import type { BoundedTransaction } from './bounded-transaction';
import { lockBillingCustomer } from './billing-authority';
import { replaceSubscriptionGrants } from './billing-grants';
import { readDatabaseTime } from './database-clock';
import { billingCustomers } from './schema/billing-customers';
import { billingSubscriptions } from './schema/billing-subscriptions';

export type BillingSynchronizationClaim = {
  readonly customerId: string;
  readonly userId: string;
  readonly vendorCustomerId: string;
  readonly mode: 'test' | 'live';
  readonly subscriptionId: string;
  readonly vendorSubscriptionId: string;
  readonly accountRevision: number;
  readonly revision: number;
  readonly claimId: string;
};
type Tx = Parameters<Parameters<BoundedTransaction>[0]>[0];
async function currentSubscription(tx: Tx, userId: string) {
  const [row] = await tx
    .select()
    .from(billingSubscriptions)
    .where(
      and(
        eq(billingSubscriptions.userId, userId),
        eq(billingSubscriptions.current, true),
      ),
    )
    .for('update');
  return row
    ? { ...row, evidence: subscriptionEvidenceSchema.parse(row.evidence) }
    : null;
}
function validClaim(input: BillingSynchronizationClaim) {
  return (
    [input.customerId, input.userId, input.subscriptionId, input.claimId].every(
      (id) => idSchema.safeParse(id).success,
    ) &&
    [input.accountRevision, input.revision].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    ) &&
    ['test', 'live'].includes(input.mode)
  );
}
function isCurrentMapping(
  locked: NonNullable<Awaited<ReturnType<typeof lockBillingCustomer>>>,
  claim: BillingSynchronizationClaim,
) {
  return (
    !locked.account.erased &&
    locked.customer.closedAt === null &&
    locked.account.userId === claim.userId &&
    locked.account.revision === claim.accountRevision &&
    locked.customer.vendorCustomerId === claim.vendorCustomerId &&
    locked.customer.mode === claim.mode
  );
}

/** The caller supplies the ordinary bounded control lane; Stripe never participates in these transactions. */
export function createBillingSynchronization(input: {
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
  readonly grants: (
    evidence: SubscriptionEvidence,
  ) => readonly EntitlementGrant[];
}) {
  return {
    claim(customerId: string) {
      return input.run(
        async (tx): Promise<BillingSynchronizationClaim | null> => {
          const locked = await lockBillingCustomer(tx, customerId);
          if (!locked || locked.account.erased || locked.customer.closedAt)
            return null;
          const subscription = await currentSubscription(
            tx,
            locked.account.userId,
          );
          if (!subscription) return null;
          const now = (await readDatabaseTime(tx)).toISOString();
          const poll = advanceBillingSync(
            locked.customer.synchronization,
            { kind: 'poll' },
            now,
          );
          const state =
            poll.kind === 'changed'
              ? poll.state
              : locked.customer.synchronization;
          const claimId = input.nextId();
          const claim = advanceBillingSync(
            state,
            { kind: 'claim', claimId },
            now,
          );
          if (claim.kind !== 'changed' || claim.state.kind !== 'claimed')
            return null;
          await tx
            .update(billingCustomers)
            .set({ synchronization: claim.state })
            .where(eq(billingCustomers.id, customerId));
          if (
            locked.customer.mode !== 'test' &&
            locked.customer.mode !== 'live'
          )
            throw createAppError('VALIDATION');
          return {
            customerId,
            userId: locked.account.userId,
            vendorCustomerId: locked.customer.vendorCustomerId,
            mode: locked.customer.mode,
            subscriptionId: subscription.id,
            vendorSubscriptionId: subscription.vendorSubscriptionId,
            accountRevision: locked.account.revision,
            revision: claim.state.revision,
            claimId,
          };
        },
      );
    },
    apply(claim: BillingSynchronizationClaim, observed: SubscriptionEvidence) {
      if (!validClaim(claim)) throw createAppError('VALIDATION');
      return input.run(async (tx) => {
        const locked = await lockBillingCustomer(tx, claim.customerId);
        if (!locked || !isCurrentMapping(locked, claim))
          return 'stale' as const;
        const subscription = await currentSubscription(
          tx,
          locked.account.userId,
        );
        if (
          !subscription ||
          subscription.id !== claim.subscriptionId ||
          subscription.vendorSubscriptionId !== claim.vendorSubscriptionId
        )
          return 'stale' as const;
        const now = await readDatabaseTime(tx);
        const transition = advanceBillingSync(
          locked.customer.synchronization,
          {
            kind: 'complete',
            revision: claim.revision,
            claimId: claim.claimId,
          },
          now.toISOString(),
        );
        if (transition.kind !== 'changed') return 'stale' as const;
        const evidence = reconcileSubscriptionEvidence(
          subscription.evidence,
          observed,
        );
        if (!evidence) throw createAppError('CONFLICT');
        if (
          evidence.settlement.kind !== 'unpaid' &&
          evidence.settlement.period.subscriptionId !== subscription.id
        )
          throw createAppError('CONFLICT');
        await tx
          .update(billingSubscriptions)
          .set({ evidence, observedAt: now })
          .where(eq(billingSubscriptions.id, subscription.id));
        await replaceSubscriptionGrants(
          tx,
          locked.account.userId,
          input.grants(evidence),
        );
        await tx
          .update(billingCustomers)
          .set({ synchronization: transition.state })
          .where(eq(billingCustomers.id, claim.customerId));
        return 'applied' as const;
      });
    },
    retry(claim: BillingSynchronizationClaim) {
      if (!validClaim(claim)) throw createAppError('VALIDATION');
      return input.run(async (tx) => {
        const locked = await lockBillingCustomer(tx, claim.customerId);
        if (
          !locked ||
          locked.account.erased ||
          locked.customer.closedAt ||
          locked.account.userId !== claim.userId ||
          locked.customer.vendorCustomerId !== claim.vendorCustomerId ||
          locked.customer.mode !== claim.mode
        )
          return false;
        const now = (await readDatabaseTime(tx)).toISOString();
        const transition = advanceBillingSync(
          locked.customer.synchronization,
          { kind: 'retry', revision: claim.revision, claimId: claim.claimId },
          now,
        );
        if (transition.kind !== 'changed') return false;
        await tx
          .update(billingCustomers)
          .set({ synchronization: transition.state })
          .where(eq(billingCustomers.id, claim.customerId));
        return true;
      });
    },
  };
}
