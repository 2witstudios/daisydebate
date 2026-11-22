import { and, eq } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol/primitives';
import { type EntitlementGrant } from '@daisy/protocol/entitlements';
import {
  advanceBillingSync,
  billingOwnerSchema,
  reconcileSubscriptionEvidence,
  subscriptionEvidenceSchema,
  purchaseSchema,
  type BillingOwner,
  type SubscriptionEvidence,
} from '@daisy/protocol/billing';
import { clubSeatBounds } from '@daisy/protocol/club-seats';
import type { BoundedTransaction } from './bounded-transaction';
import {
  billingOwnerClosed,
  billingOwnerRevision,
  lockBillingCustomer,
  type LockedBillingCustomer,
} from './billing-authority';
import { replaceSubscriptionGrants } from './billing-grants';
import { readDatabaseTime } from './database-clock';
import { billingCustomers } from './schema/billing-customers';
import { billingSubscriptions } from './schema/billing-subscriptions';
import { readFrozenBillingOffer } from './billing-frozen-offer';
import { ownedBy } from './billing-owner-lock';
import {
  lockClubSeatHolderAccounts,
  readClubSeats,
  sameHolders,
  writeClubSeatGrants,
  type ClubSeatGrantProjection,
} from './club-seat-grants';
import type { Tx } from './tx';

export type BillingSynchronizationClaim = {
  readonly customerId: string;
  readonly owner: BillingOwner;
  readonly vendorCustomerId: string;
  readonly mode: 'test' | 'live';
  readonly subscriptionId: string;
  readonly vendorSubscriptionId: string;
  readonly priceId: string;
  /** The owner's revision when claimed: the account's, or the club's. */
  readonly ownerRevision: number;
  readonly revision: number;
  readonly claimId: string;
};
/** Display terms and the Club seat count from the same verified observation; never access authority. */
export type SubscriptionTerms = {
  readonly renewalOff: boolean;
  readonly amountMinor: number;
  /** A Club plan's verified seat count; null for Premium. */
  readonly seatCount: number | null;
};
/** How evidence becomes grants: Premium for an account, seat grants for a club's holders. */
export type GrantProjections = {
  readonly account: (
    evidence: SubscriptionEvidence,
  ) => readonly EntitlementGrant[];
  readonly club: ClubSeatGrantProjection;
};
async function currentSubscription(tx: Tx, owner: BillingOwner) {
  const [row] = await tx
    .select()
    .from(billingSubscriptions)
    .where(
      and(
        ownedBy(billingSubscriptions, owner),
        eq(billingSubscriptions.current, true),
      ),
    )
    .for('update');
  return row
    ? { ...row, evidence: subscriptionEvidenceSchema.parse(row.evidence) }
    : null;
}
const ownerOfLocked = (locked: LockedBillingCustomer): BillingOwner =>
  locked.kind === 'account'
    ? { kind: 'account', userId: locked.account.userId }
    : { kind: 'organization', organizationId: locked.club.id };
const sameOwner = (left: BillingOwner, right: BillingOwner) =>
  left.kind === 'account'
    ? right.kind === 'account' && left.userId === right.userId
    : right.kind === 'organization' &&
      left.organizationId === right.organizationId;
function validClaim(input: BillingSynchronizationClaim) {
  return (
    [input.customerId, input.subscriptionId, input.claimId].every(
      (id) => idSchema.safeParse(id).success,
    ) &&
    billingOwnerSchema.safeParse(input.owner).success &&
    [input.ownerRevision, input.revision].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    ) &&
    ['test', 'live'].includes(input.mode) &&
    purchaseSchema.shape.priceId.safeParse(input.priceId).success
  );
}
function validTerms(owner: BillingOwner, terms: SubscriptionTerms) {
  return (
    Number.isSafeInteger(terms.amountMinor) &&
    terms.amountMinor >= 1 &&
    (owner.kind === 'account'
      ? terms.seatCount === null
      : Number.isSafeInteger(terms.seatCount) &&
        terms.seatCount !== null &&
        terms.seatCount >= 1 &&
        terms.seatCount <= clubSeatBounds.maxSeats)
  );
}
function isCurrentMapping(
  locked: LockedBillingCustomer,
  claim: BillingSynchronizationClaim,
) {
  return (
    !billingOwnerClosed(locked) &&
    locked.customer.closedAt === null &&
    sameOwner(ownerOfLocked(locked), claim.owner) &&
    billingOwnerRevision(locked) === claim.ownerRevision &&
    locked.customer.vendorCustomerId === claim.vendorCustomerId &&
    locked.customer.mode === claim.mode
  );
}

/**
 * A club's apply writes every seat holder's grants, so their account fences
 * come first: read the holders, lock their accounts, then the club and the
 * customer, and re-read the holders. A changed holder set is stale; the
 * customer stays claimable and the next tick tries again.
 */
async function lockForApply(tx: Tx, claim: BillingSynchronizationClaim) {
  if (claim.owner.kind === 'account')
    return {
      locked: await lockBillingCustomer(tx, claim.customerId),
      seats: null,
    };
  const fenced = await lockClubSeatHolderAccounts(
    tx,
    claim.owner.organizationId,
  );
  const locked = await lockBillingCustomer(tx, claim.customerId);
  if (!locked || locked.kind !== 'organization')
    return { locked: null, seats: null };
  const seats = await readClubSeats(tx, locked.club.id);
  return sameHolders(seats, fenced.seats)
    ? { locked, seats }
    : { locked: null, seats: null };
}

/** The caller supplies the ordinary bounded control lane; Stripe never participates in these transactions. */
export function createBillingSynchronization(input: {
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
  readonly grants: GrantProjections;
}) {
  return {
    claim(customerId: string) {
      return input.run(
        async (tx): Promise<BillingSynchronizationClaim | null> => {
          const locked = await lockBillingCustomer(tx, customerId);
          if (!locked || billingOwnerClosed(locked) || locked.customer.closedAt)
            return null;
          const owner = ownerOfLocked(locked);
          const subscription = await currentSubscription(tx, owner);
          if (!subscription) return null;
          if (
            locked.customer.mode !== 'test' &&
            locked.customer.mode !== 'live'
          )
            throw createAppError('VALIDATION');
          const offer = await readFrozenBillingOffer(tx, {
            owner,
            mode: locked.customer.mode,
            customerId: locked.customer.vendorCustomerId,
            vendorSubscriptionId: subscription.vendorSubscriptionId,
          });
          if (!offer) throw createAppError('CONFLICT');
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
          return {
            customerId,
            owner,
            vendorCustomerId: locked.customer.vendorCustomerId,
            mode: locked.customer.mode,
            subscriptionId: subscription.id,
            vendorSubscriptionId: subscription.vendorSubscriptionId,
            priceId: offer.priceId,
            ownerRevision: billingOwnerRevision(locked),
            revision: claim.state.revision,
            claimId,
          };
        },
      );
    },
    apply(
      claim: BillingSynchronizationClaim,
      observed: SubscriptionEvidence,
      terms: SubscriptionTerms,
    ) {
      if (!validClaim(claim) || !validTerms(claim.owner, terms))
        throw createAppError('VALIDATION');
      return input.run(async (tx) => {
        const { locked, seats } = await lockForApply(tx, claim);
        if (!locked || !isCurrentMapping(locked, claim))
          return 'stale' as const;
        const owner = ownerOfLocked(locked);
        const subscription = await currentSubscription(tx, owner);
        if (
          !subscription ||
          subscription.id !== claim.subscriptionId ||
          subscription.vendorSubscriptionId !== claim.vendorSubscriptionId
        )
          return 'stale' as const;
        const offer = await readFrozenBillingOffer(tx, {
          owner,
          mode: claim.mode,
          customerId: locked.customer.vendorCustomerId,
          vendorSubscriptionId: subscription.vendorSubscriptionId,
        });
        if (offer?.priceId !== claim.priceId) return 'stale' as const;
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
          .set({ evidence, observedAt: now, ...terms })
          .where(eq(billingSubscriptions.id, subscription.id));
        if (locked.kind === 'account')
          await replaceSubscriptionGrants(
            tx,
            locked.account.userId,
            input.grants.account(evidence),
          );
        else
          await writeClubSeatGrants(
            tx,
            locked.club.id,
            input.grants.club({
              organizationId: locked.club.id,
              evidence,
              seatCount: terms.seatCount ?? 0,
              seats: seats ?? [],
            }),
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
          billingOwnerClosed(locked) ||
          locked.customer.closedAt ||
          !sameOwner(ownerOfLocked(locked), claim.owner) ||
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
