import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import type { BillingOwner } from '@daisy/protocol/billing';
import { scopeTransaction } from './tenant-scope';
import { billingCustomers } from './schema/billing-customers';
import { billingPurchases } from './schema/billing-purchases';
import { billingSubscriptions } from './schema/billing-subscriptions';
import type { Tx } from './tx';

/** A club may buy seats: a school or club, or a homeschool family (ADR 0148). */
export const clubOrganizationKinds = ['school', 'family'] as const;

export type LockedClub = {
  readonly id: string;
  readonly kind: (typeof clubOrganizationKinds)[number];
  readonly name: string;
  readonly handle: string;
  readonly ownerUserId: string;
  readonly closed: boolean;
  readonly revision: number;
};

type OwnedTable =
  | typeof billingCustomers
  | typeof billingSubscriptions
  | typeof billingPurchases;

/** The one owner a billing row belongs to, as a WHERE condition. */
export function ownedBy(table: OwnedTable, owner: BillingOwner): SQL {
  return owner.kind === 'account'
    ? and(eq(table.userId, owner.userId), isNull(table.organizationId))!
    : and(
        eq(table.organizationId, owner.organizationId),
        isNull(table.userId),
      )!;
}

/**
 * Locks a club's organisation row for billing, after any account fences the
 * caller already holds (account fences first, then the organisation, then
 * billing rows). Sets the transaction's organisation scope so the club's own
 * tenant rows are reachable; `subjectUserId` additionally lets that person's
 * own rows (their seat in another club) be read. Null when no club exists.
 */
export async function lockClub(
  tx: Tx,
  organizationId: string,
  subjectUserId?: string,
): Promise<LockedClub | null> {
  if (!idSchema.safeParse(organizationId).success)
    throw createAppError('VALIDATION');
  await scopeTransaction(tx, { organizationId, subjectUserId });
  const [row] = await tx.execute(
    sql`select id, kind, name, handle, owner_user_id, closed_at, version
      from organizations where id=${organizationId} for update`,
  );
  if (
    !row ||
    typeof row.id !== 'string' ||
    typeof row.owner_user_id !== 'string' ||
    !clubOrganizationKinds.includes(
      row.kind as (typeof clubOrganizationKinds)[number],
    )
  )
    return null;
  return {
    id: row.id,
    kind: row.kind as LockedClub['kind'],
    name: String(row.name),
    handle: String(row.handle),
    ownerUserId: row.owner_user_id,
    closed: row.closed_at !== null,
    revision: Number(row.version),
  };
}

/** The owner's billing customer and current subscription, locked for update. */
export async function lockOwnerBillingRows(tx: Tx, owner: BillingOwner) {
  const [customer] = await tx
    .select()
    .from(billingCustomers)
    .where(ownedBy(billingCustomers, owner))
    .for('update');
  const [subscription] = await tx
    .select()
    .from(billingSubscriptions)
    .where(
      and(
        ownedBy(billingSubscriptions, owner),
        eq(billingSubscriptions.current, true),
      ),
    )
    .for('update');
  return { customer, subscription };
}
