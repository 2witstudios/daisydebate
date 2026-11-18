import { createAppError } from '@daisy/errors';
import { subscriptionEvidenceSchema } from '@daisy/protocol/billing';
import { readDatabaseTime } from './database-clock';
import {
  lockPurchaseSubject,
  type PurchaseSubject,
} from './billing-purchase-authority';
import { z } from 'zod';
import { permitsNewSubscription } from './billing-purchase-mapping';
import type { BoundedTransactionContext } from './transaction-context';
import type { BoundedTransaction } from './bounded-transaction';

type Account = Awaited<ReturnType<typeof lockPurchaseSubject>>['account'];

/** Member reads share purchase/closure account fences; billing shows no usage (PYL-10). */
export function createBillingMember(input: {
  readonly run: BoundedTransaction;
  readonly manage: (account: Account) => boolean;
  readonly purchase: (account: Account) => boolean;
}) {
  const owned = async (
    tx: BoundedTransactionContext,
    subject: PurchaseSubject,
  ) => {
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
        return {
          now: (await readDatabaseTime(tx)).toISOString(),
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
