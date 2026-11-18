import { and, eq, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  billingOwnerOf,
  billingSyncStateSchema,
} from '@daisy/protocol/billing';
import { lockAuthorizationActors } from './authorization';
import type { BoundedTransactionContext } from './transaction-context';
import { billingCustomers } from './schema/billing-customers';
import { lockClub, type LockedClub } from './billing-owner-lock';

type Account = NonNullable<
  Awaited<ReturnType<typeof lockAuthorizationActors>>[number]
>;
type Customer = Omit<
  typeof billingCustomers.$inferSelect,
  'synchronization'
> & {
  readonly synchronization: ReturnType<typeof billingSyncStateSchema.parse>;
};
/** A locked billing customer and the owner fence it was locked behind (ADR 0148). */
export type LockedBillingCustomer =
  | {
      readonly kind: 'account';
      readonly account: Account;
      readonly customer: Customer;
    }
  | {
      readonly kind: 'organization';
      readonly club: LockedClub;
      readonly customer: Customer;
    };

/** The owner fence a customer's facts change behind: an erased account or a closed club stops new access. */
export const billingOwnerClosed = (locked: LockedBillingCustomer) =>
  locked.kind === 'account' ? locked.account.erased : locked.club.closed;
/** The owner revision a claim is fenced on. */
export const billingOwnerRevision = (locked: LockedBillingCustomer) =>
  locked.kind === 'account' ? locked.account.revision : locked.club.revision;

async function lockCustomerRow(
  tx: BoundedTransactionContext,
  customerId: string,
): Promise<Customer | null> {
  const [customer] = await tx
    .select()
    .from(billingCustomers)
    .where(eq(billingCustomers.id, customerId))
    .for('update');
  return customer
    ? {
        ...customer,
        synchronization: billingSyncStateSchema.parse(customer.synchronization),
      }
    : null;
}

/**
 * Discovery is only a selector. The owner's fence always precedes billing
 * rows: an account's canonical fence, or a club's organisation row. A caller
 * that also writes seat holders' grants takes their account fences before
 * calling this (account fences, then the club, then billing rows).
 */
export async function lockBillingCustomer(
  tx: BoundedTransactionContext,
  customerId: string,
): Promise<LockedBillingCustomer | null> {
  if (!idSchema.safeParse(customerId).success)
    throw createAppError('VALIDATION');
  const [target] = await tx
    .select({
      userId: billingCustomers.userId,
      organizationId: billingCustomers.organizationId,
    })
    .from(billingCustomers)
    .where(eq(billingCustomers.id, customerId));
  const owner = target ? billingOwnerOf(target) : null;
  if (!owner) return null;
  if (owner.kind === 'organization') {
    const club = await lockClub(tx, owner.organizationId);
    const customer = club ? await lockCustomerRow(tx, customerId) : null;
    return club && customer?.organizationId === club.id
      ? { kind: 'organization', club, customer }
      : null;
  }
  const [actor] = await tx.execute(
    sql`select id from actors where user_id=${owner.userId} and kind='human'`,
  );
  if (!actor || typeof actor.id !== 'string') return null;
  const [account] = await lockAuthorizationActors(tx, [actor.id], {
    maxActors: 1,
  });
  if (!account || account.userId !== owner.userId) return null;
  const [customer] = await tx
    .select()
    .from(billingCustomers)
    .where(
      and(
        eq(billingCustomers.id, customerId),
        eq(billingCustomers.userId, account.userId),
      ),
    )
    .for('update');
  return customer
    ? {
        kind: 'account',
        account,
        customer: {
          ...customer,
          synchronization: billingSyncStateSchema.parse(
            customer.synchronization,
          ),
        },
      }
    : null;
}
