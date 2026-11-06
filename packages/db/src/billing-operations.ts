import { createBillingMember } from './billing-member';
import type { BoundedTransaction } from './bounded-transaction';
import { currentWebTransaction } from './web-service-authority';
import { createBillingInbox } from './billing-inbox';
import { createBillingDiscovery } from './billing-discovery';
import { createBillingSynchronization } from './billing-synchronization';
import { createBillingPurchaseRecovery } from './billing-purchase-recovery';
import { createBillingRefundActions } from './billing-refund-actions';
import { createBillingCleanup } from './billing-cleanup';
import {
  createBillingPurchases,
  type BillingPurchasePolicies,
} from './billing-purchase-store';

type GrantProjection = Parameters<
  typeof createBillingSynchronization
>[0]['grants'];

/** HTTP receipt and scheduled repair share the same durable inbox/application adapters. */
export function billingOperations(input: {
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
}) {
  return {
    billingMember(
      policies: Omit<Parameters<typeof createBillingMember>[0], 'run'>,
    ) {
      return createBillingMember({ run: input.run, ...policies });
    },
    billingCleanup(instanceId: string) {
      return createBillingCleanup({
        run: currentWebTransaction(input.run, instanceId),
        nextId: input.nextId,
      });
    },
    billingRefunds(instanceId: string) {
      return createBillingRefundActions({
        run: currentWebTransaction(input.run, instanceId),
        nextId: input.nextId,
      });
    },
    billingPurchases(policies: BillingPurchasePolicies) {
      return createBillingPurchases({ ...input, policies });
    },
    billingPurchaseRecovery(instanceId: string) {
      return createBillingPurchaseRecovery({
        run: currentWebTransaction(input.run, instanceId),
        nextId: input.nextId,
      });
    },
    receiveBillingReceipt: createBillingInbox(input),
    billingSynchronization(instanceId: string, grants: GrantProjection) {
      const run = currentWebTransaction(input.run, instanceId);
      return {
        ...createBillingDiscovery(run),
        ...createBillingSynchronization({ run, nextId: input.nextId, grants }),
        receive: createBillingInbox({ run, nextId: input.nextId }),
      };
    },
  };
}
