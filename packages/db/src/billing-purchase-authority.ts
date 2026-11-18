import { and, eq } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  billingOwnerOf,
  purchaseSchema,
  type BillingOwner,
  type Purchase,
} from '@daisy/protocol/billing';
import { lockAuthorizationActors, requireOwnScope } from './authorization';
import type { BoundedTransactionContext } from './transaction-context';
import { billingCustomers } from './schema/billing-customers';
import { billingPurchases } from './schema/billing-purchases';
import { billingSubscriptions } from './schema/billing-subscriptions';
import { actors } from './schema/actors';
import { users } from './schema/users';
import { readDatabaseTime } from './database-clock';
import {
  lockClub,
  lockOwnerBillingRows,
  ownedBy,
  type LockedClub,
} from './billing-owner-lock';

/**
 * The acting account, and the club it buys for when it buys Club seats
 * (ADR 0148). Without `organizationId` the account buys Premium for itself.
 */
export type PurchaseSubject = {
  readonly userId: string;
  readonly actorId: string;
  readonly organizationId?: string;
};
export const subjectOwner = (subject: PurchaseSubject): BillingOwner =>
  subject.organizationId === undefined
    ? { kind: 'account', userId: subject.userId }
    : { kind: 'organization', organizationId: subject.organizationId };
export function parsePurchase(input: unknown): Purchase {
  const parsed = purchaseSchema.safeParse(input);
  if (!parsed.success) throw createAppError('VALIDATION');
  return parsed.data;
}
export const purchaseFromRow = (row: typeof billingPurchases.$inferSelect) =>
  parsePurchase({
    id: row.id,
    owner: billingOwnerOf(row),
    quantity: row.quantity,
    mode: row.mode,
    priceId: row.priceId,
    customerId: row.vendorCustomerId,
    returnOrigin: row.returnOrigin,
    admittedAt: row.admittedAt.toISOString(),
    state: row.state,
  });

/**
 * The same account-first order for member operations and current-service
 * recovery. Buying for a club then locks the club (its owner alone manages
 * the club's billing) before the club's billing rows.
 */
export async function lockPurchaseSubject(
  tx: BoundedTransactionContext,
  subject: PurchaseSubject,
): Promise<{
  readonly account: NonNullable<
    Awaited<ReturnType<typeof lockAuthorizationActors>>[number]
  >;
  readonly owner: BillingOwner;
  readonly club: LockedClub | null;
  readonly customer: typeof billingCustomers.$inferSelect | undefined;
  readonly subscription: typeof billingSubscriptions.$inferSelect | undefined;
}> {
  requireOwnScope(subject);
  const [account] = await lockAuthorizationActors(tx, [subject.actorId], {
    maxActors: 1,
  });
  if (
    !account ||
    account.userId !== subject.userId ||
    account.actorId !== subject.actorId
  )
    throw createAppError('AUTHORIZATION');
  const owner = subjectOwner(subject);
  let club: LockedClub | null = null;
  if (owner.kind === 'organization') {
    club = await lockClub(tx, owner.organizationId, subject.userId);
    if (!club || club.ownerUserId !== subject.userId)
      throw createAppError('AUTHORIZATION');
  }
  const { customer, subscription } = await lockOwnerBillingRows(tx, owner);
  return { account, owner, club, customer, subscription };
}

async function findOwnedPurchase(
  tx: BoundedTransactionContext,
  owner: BillingOwner,
  id: string,
) {
  if (!idSchema.safeParse(id).success) throw createAppError('VALIDATION');
  const [row] = await tx
    .select()
    .from(billingPurchases)
    .where(and(eq(billingPurchases.id, id), ownedBy(billingPurchases, owner)))
    .for('update');
  return row ? purchaseFromRow(row) : null;
}

export async function ownedPurchase(
  tx: BoundedTransactionContext,
  subject: PurchaseSubject,
  id: string,
) {
  const purchase = await findOwnedPurchase(tx, subjectOwner(subject), id);
  if (!purchase) throw createAppError('NOT_FOUND');
  return purchase;
}

export async function savePurchase(
  tx: BoundedTransactionContext,
  purchase: Purchase,
) {
  const checked = parsePurchase(purchase);
  await tx
    .update(billingPurchases)
    .set({ state: checked.state })
    .where(eq(billingPurchases.id, checked.id));
}

/** A selector is only a hint; closure and every business fact are read after the owner's fence. */
export async function lockPurchaseId(
  tx: BoundedTransactionContext,
  id: string,
) {
  if (!idSchema.safeParse(id).success) throw createAppError('VALIDATION');
  const [selector] = await tx
    .select({
      userId: billingPurchases.userId,
      organizationId: billingPurchases.organizationId,
    })
    .from(billingPurchases)
    .where(eq(billingPurchases.id, id));
  const owner = selector ? billingOwnerOf(selector) : null;
  if (!owner) return null;
  return owner.kind === 'account'
    ? lockAccountPurchaseId(tx, owner.userId, id)
    : lockClubPurchaseId(tx, owner.organizationId, id);
}

async function lockAccountPurchaseId(
  tx: BoundedTransactionContext,
  userId: string,
  id: string,
) {
  const [subject] = await tx
    .select({ userId: actors.userId, actorId: actors.id })
    .from(actors)
    .where(and(eq(actors.userId, userId), eq(actors.kind, 'human')));
  if (!subject?.userId) return null;
  const locked = await lockPurchaseSubject(tx, {
    userId: subject.userId,
    actorId: subject.actorId,
  });
  const purchase = await findOwnedPurchase(tx, locked.owner, id);
  if (!purchase) return null;
  return {
    ...locked,
    purchase,
    ...(await purchaseClosure(tx, locked, subject.userId)),
  };
}

/** Service recovery of a club's purchase: no acting account, the club row is the fence. */
async function lockClubPurchaseId(
  tx: BoundedTransactionContext,
  organizationId: string,
  id: string,
) {
  const club = await lockClub(tx, organizationId);
  if (!club) return null;
  const owner: BillingOwner = { kind: 'organization', organizationId };
  const { customer, subscription } = await lockOwnerBillingRows(tx, owner);
  const purchase = await findOwnedPurchase(tx, owner, id);
  if (!purchase) return null;
  if (customer?.closedAt && !club.closed) throw createAppError('CONFLICT');
  return {
    owner,
    club,
    customer,
    subscription,
    purchase,
    closedAt: null,
    context: {
      now: (await readDatabaseTime(tx)).toISOString(),
      // A closed club's checkout completes into nothing: it is never active.
      authority: club.closed ? ('denied' as const) : ('active' as const),
    },
  };
}

async function purchaseClosure(
  tx: BoundedTransactionContext,
  locked: Awaited<ReturnType<typeof lockPurchaseSubject>>,
  userId: string,
) {
  const [account] = await tx
    .select({ closedAt: users.deletedAt })
    .from(users)
    .where(eq(users.id, userId));
  if (!account || locked.account.erased !== (account.closedAt !== null))
    throw createAppError('CONFLICT');
  if (locked.customer?.closedAt && account.closedAt === null)
    throw createAppError('CONFLICT');
  return {
    closedAt: account.closedAt?.toISOString() ?? null,
    context: {
      now: (await readDatabaseTime(tx)).toISOString(),
      authority:
        account.closedAt === null ? ('active' as const) : ('closed' as const),
    },
  };
}
