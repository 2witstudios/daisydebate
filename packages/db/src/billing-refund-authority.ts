import { and, eq, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { refundActionSchema } from '@daisy/protocol/billing';
import { lockAuthorizationActors } from './authorization';
import type { BoundedTransactionContext } from './transaction-context';
import { billingRefundActions } from './schema/billing-refund-actions';
import { users } from './schema/users';

export const refundFromRow = (row: typeof billingRefundActions.$inferSelect) =>
  refundActionSchema.parse({
    id: row.id,
    userId: row.userId,
    mode: row.mode,
    customerId: row.vendorCustomerId,
    chargeId: row.vendorChargeId,
    invoiceId: row.vendorInvoiceId,
    vendorSubscriptionId: row.vendorSubscriptionId,
    amountMinor: row.amountMinor,
    currency: row.currency,
    period: {
      startsAt: row.periodStartsAt.toISOString(),
      endsAt: row.periodEndsAt.toISOString(),
    },
    closedAt: row.closedAt.toISOString(),
    paidAtSeconds: row.paidAtSeconds,
    admittedAt: row.admittedAt.toISOString(),
    state: row.state,
    claim: row.claim,
  });

/** Closed-account financial recovery keeps the same canonical account fence after customer deletion. */
export async function lockRefundAccount(
  tx: BoundedTransactionContext,
  userId: string,
) {
  if (!idSchema.safeParse(userId).success) throw createAppError('VALIDATION');
  const [actor] = await tx.execute(
    sql`select id from actors where user_id=${userId} and kind='human'`,
  );
  if (!actor || typeof actor.id !== 'string')
    throw createAppError('AUTHORIZATION');
  const [account] = await lockAuthorizationActors(tx, [actor.id], {
    maxActors: 1,
  });
  if (!account || account.userId !== userId || !account.erased)
    throw createAppError('AUTHORIZATION');
  const [closed] = await tx
    .select({ closedAt: users.deletedAt })
    .from(users)
    .where(eq(users.id, userId));
  if (!closed?.closedAt) throw createAppError('AUTHORIZATION');
  return closed.closedAt.toISOString();
}

export async function lockRefundAction(
  tx: BoundedTransactionContext,
  id: string,
) {
  if (!idSchema.safeParse(id).success) throw createAppError('VALIDATION');
  const [selector] = await tx
    .select({ userId: billingRefundActions.userId })
    .from(billingRefundActions)
    .where(eq(billingRefundActions.id, id));
  if (!selector) return null;
  const closedAt = await lockRefundAccount(tx, selector.userId);
  const [row] = await tx
    .select()
    .from(billingRefundActions)
    .where(
      and(
        eq(billingRefundActions.id, id),
        eq(billingRefundActions.userId, selector.userId),
      ),
    )
    .for('update');
  if (!row) return null;
  const action = refundFromRow(row);
  if (action.closedAt !== closedAt) throw createAppError('CONFLICT');
  return action;
}

/** Original owned mapping, possible purchase, or retained action supplies routing; never a client-selected customer. */
export async function requireRefundCustomer(
  tx: BoundedTransactionContext,
  userId: string,
  mode: string,
  customerId: string,
) {
  const [owned] = await tx.execute(sql`select exists(
    select 1 from billing_customers where user_id=${userId} and mode=${mode} and vendor_customer_id=${customerId} and closed_at is not null
    union all select 1 from billing_purchases where user_id=${userId} and mode=${mode} and state->>'customerId'=${customerId}
    union all select 1 from billing_refund_actions where user_id=${userId} and mode=${mode} and vendor_customer_id=${customerId}
    union all select 1 from billing_payment_observations where user_id=${userId} and mode=${mode} and vendor_customer_id=${customerId}
  ) as owned`);
  if (owned?.owned !== true) throw createAppError('AUTHORIZATION');
}

/** Retained financial routing remains usable after ordinary customer cleanup. */
export async function lockRetainedRefundCustomer(
  tx: BoundedTransactionContext,
  mode: string,
  customerId: string,
) {
  const owners = await tx.execute(sql`select user_id as "userId" from (
    select user_id from billing_refund_actions where mode=${mode} and vendor_customer_id=${customerId}
    union select user_id from billing_payment_observations where mode=${mode} and vendor_customer_id=${customerId}
  ) retained_owners limit 2`);
  if (owners.length === 0) return null;
  if (owners.length !== 1) throw createAppError('CONFLICT');
  const userId = owners[0]!.userId;
  if (typeof userId !== 'string') throw createAppError('CONFLICT');
  await lockRefundAccount(tx, userId);
  await requireRefundCustomer(tx, userId, mode, customerId);
  return userId;
}
