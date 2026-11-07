import { and, eq, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { billingSyncStateSchema } from '@daisy/protocol/billing';
import { lockAuthorizationActors } from './authorization';
import type { BoundedTransactionContext } from './transaction-context';
import { billingCustomers } from './schema/billing-customers';

/** Discovery is only a selector. The canonical account fence always precedes billing rows. */
export async function lockBillingCustomer(
  tx: BoundedTransactionContext,
  customerId: string,
) {
  if (!idSchema.safeParse(customerId).success)
    throw createAppError('VALIDATION');
  const [target] = await tx
    .select({ userId: billingCustomers.userId })
    .from(billingCustomers)
    .where(eq(billingCustomers.id, customerId));
  if (!target) return null;
  const [actor] = await tx.execute(
    sql`select id from actors where user_id=${target.userId} and kind='human'`,
  );
  if (!actor || typeof actor.id !== 'string') return null;
  const [account] = await lockAuthorizationActors(tx, [actor.id], {
    maxActors: 1,
  });
  if (!account || account.userId !== target.userId) return null;
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
