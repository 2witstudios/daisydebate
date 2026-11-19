import { createAppError } from '@daisy/errors';
import { subscriptionEvidenceSchema } from '@daisy/protocol/billing';
import { readDatabaseTime } from './database-clock';
import { readEntitlementGrants } from './entitlement-grants';
import {
  lockPurchaseSubject,
  type PurchaseSubject,
} from './billing-purchase-authority';
import { z } from 'zod';
import { permitsNewSubscription } from './billing-purchase-mapping';
import type { BoundedTransaction } from './bounded-transaction';
import type { Tx } from './tx';

type Account = Awaited<ReturnType<typeof lockPurchaseSubject>>['account'];

/** Member reads share purchase/closure account fences; billing shows no usage (PYL-10). */
export function createBillingMember(input: {
  readonly run: BoundedTransaction;
  readonly manage: (account: Account) => boolean;
  readonly purchase: (account: Account) => boolean;
  /** Whether current grants give Premium without a subscription (a beta grant). */
  readonly granted: (
    grants: Awaited<ReturnType<typeof readEntitlementGrants>>,
    now: string,
  ) => boolean;
}) {
  const owned = async (tx: Tx, subject: PurchaseSubject) => {
    const locked = await lockPurchaseSubject(tx, subject);
    if (!input.manage(locked.account) || locked.customer?.closedAt)
      throw createAppError('AUTHORIZATION');
    return locked;
  };
  return {
    portalCustomer: (subject: PurchaseSubject) =>
      input.run(async (tx) => {
        const { customer } = await owned(tx, subject);
        return customer
          ? {
              id: customer.vendorCustomerId,
              mode: z.enum(['test', 'live']).parse(customer.mode),
            }
          : null;
      }),
    read: (subject: PurchaseSubject) =>
      input.run(async (tx) => {
        const { account, customer, subscription } = await owned(tx, subject);
        const now = (await readDatabaseTime(tx)).toISOString();
        return {
          now,
          granted: input.granted(
            await readEntitlementGrants(tx, account.userId),
            now,
          ),
          evidence: subscription
            ? subscriptionEvidenceSchema.parse(subscription.evidence)
            : null,
          renewalOff: subscription?.renewalOff ?? false,
          amountMinor: subscription?.amountMinor ?? null,
          purchaseAllowed:
            input.purchase(account) && permitsNewSubscription(subscription),
          hasCustomer: customer !== undefined && customer !== null,
          subscriptionLifecycle: subscription?.evidence.lifecycle ?? null,
        };
      }),
  };
}
