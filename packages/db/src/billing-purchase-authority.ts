import { and, eq } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { purchaseSchema, type Purchase } from '@daisy/protocol/billing';
import { lockAuthorizationActors, requireOwnScope } from './authorization';
import type { BoundedTransactionContext } from './transaction-context';
import { billingCustomers } from './schema/billing-customers';
import { billingPurchases } from './schema/billing-purchases';
import { billingSubscriptions } from './schema/billing-subscriptions';
import { actors } from './schema/actors';
import { users } from './schema/users';
import { readDatabaseTime } from './database-clock';

export type PurchaseSubject = {
  readonly userId: string;
  readonly actorId: string;
};
export function parsePurchase(input: unknown): Purchase {
  const parsed = purchaseSchema.safeParse(input);
  if (!parsed.success) throw createAppError('VALIDATION');
  return parsed.data;
}
export const purchaseFromRow = (row: typeof billingPurchases.$inferSelect) =>
  parsePurchase({
    id: row.id,
    userId: row.userId,
    mode: row.mode,
    priceId: row.priceId,
    customerId: row.vendorCustomerId,
    returnOrigin: row.returnOrigin,
    admittedAt: row.admittedAt.toISOString(),
    state: row.state,
  });

/** The same account-first order for member operations and current-service recovery. */
export async function lockPurchaseSubject(
  tx: BoundedTransactionContext,
  subject: PurchaseSubject,
) {
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
  const [customer] = await tx
    .select()
    .from(billingCustomers)
    .where(eq(billingCustomers.userId, subject.userId))
    .for('update');
  const [subscription] = await tx
    .select()
    .from(billingSubscriptions)
    .where(
      and(
        eq(billingSubscriptions.userId, subject.userId),
        eq(billingSubscriptions.current, true),
      ),
    )
    .for('update');
  return { account, customer, subscription };
}

async function findOwnedPurchase(
  tx: BoundedTransactionContext,
  subject: PurchaseSubject,
  id: string,
) {
  if (!idSchema.safeParse(id).success) throw createAppError('VALIDATION');
  const [row] = await tx
    .select()
    .from(billingPurchases)
    .where(
      and(
        eq(billingPurchases.id, id),
        eq(billingPurchases.userId, subject.userId),
      ),
    )
    .for('update');
  return row ? purchaseFromRow(row) : null;
}

export async function ownedPurchase(
  tx: BoundedTransactionContext,
  subject: PurchaseSubject,
  id: string,
) {
  const purchase = await findOwnedPurchase(tx, subject, id);
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

/** A selector is only a hint; closure and every business fact are read after the account fence. */
export async function lockPurchaseId(
  tx: BoundedTransactionContext,
  id: string,
) {
  if (!idSchema.safeParse(id).success) throw createAppError('VALIDATION');
  const [subject] = await tx
    .select({ userId: billingPurchases.userId, actorId: actors.id })
    .from(billingPurchases)
    .innerJoin(
      actors,
      and(eq(actors.userId, billingPurchases.userId), eq(actors.kind, 'human')),
    )
    .where(eq(billingPurchases.id, id));
  if (!subject) return null;
  const locked = await lockPurchaseSubject(tx, subject);
  const purchase = await findOwnedPurchase(tx, subject, id);
  if (!purchase) return null;
  return {
    ...locked,
    purchase,
    ...(await purchaseClosure(tx, locked, subject.userId)),
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
