import { createAppError } from '@daisy/errors';
import { advancePurchase, type PurchaseEvent } from '@daisy/protocol/billing';
import type { BoundedTransaction } from './bounded-transaction';
import { lockPurchaseId, savePurchase } from './billing-purchase-authority';
import { createBillingPurchaseDiscovery } from './billing-purchase-discovery';
import { completePurchaseMapping } from './billing-purchase-mapping';
import { enqueuePrivacyJob } from './privacy/enqueue-job';
import { billingCustomers } from './schema/billing-customers';

type LockedPurchase = NonNullable<Awaited<ReturnType<typeof lockPurchaseId>>>;
type Transaction = Parameters<typeof lockPurchaseId>[0];

/** Closed identity is retained only to cancel/delete at the vendor; it is never a subscription. */
async function retainClosedCustomer(
  tx: Transaction,
  locked: LockedPurchase,
  nextId: () => string,
) {
  const { purchase, customer, context } = locked;
  const { state } = purchase;
  if (!('customerId' in state) || state.customerId === null) return;
  if (customer) {
    if (
      !customer.closedAt ||
      customer.mode !== purchase.mode ||
      customer.vendorCustomerId !== state.customerId
    )
      throw createAppError('CONFLICT');
    return;
  }
  await tx.insert(billingCustomers).values({
    id: nextId(),
    userId: purchase.userId,
    mode: purchase.mode,
    vendorCustomerId: state.customerId,
    createdAt: new Date(context.now),
    closedAt: new Date(context.now),
    synchronization: {
      kind: 'settled',
      revision: 1,
      observedAt: context.now,
      nextAt: context.now,
    },
  });
}

/** Verified facts are applied under fresh service/account authority, separately from vendor I/O. */
export function createBillingPurchaseRecovery(input: {
  readonly run: BoundedTransaction;
  readonly nextId: () => string;
}) {
  return {
    ...createBillingPurchaseDiscovery(input.run),
    record(
      id: string,
      event: Extract<PurchaseEvent, { kind: 'observe' | 'searched' }>,
    ) {
      return input.run(async (tx) => {
        const locked = await lockPurchaseId(tx, id);
        if (!locked) return 'missing' as const;
        const transition = advancePurchase(
          locked.purchase,
          event,
          locked.context,
        );
        if (transition.kind !== 'changed') return transition.kind;
        const purchase = { ...locked.purchase, state: transition.state };
        if (locked.context.authority === 'closed') {
          await retainClosedCustomer(tx, { ...locked, purchase }, input.nextId);
          // Cursor progress is not a new vendor fact. Identical observations return above.
          if (event.kind === 'observe')
            await enqueuePrivacyJob(tx, {
              id: input.nextId(),
              subjectRef: purchase.userId,
              vendor: 'stripe',
              createdAt: locked.context.now,
            });
        } else if (purchase.state.kind === 'complete') {
          await completePurchaseMapping({
            tx,
            purchase,
            customer: locked.customer,
            subscription: locked.subscription,
            now: locked.context.now,
            nextId: input.nextId,
          });
        }
        await savePurchase(tx, purchase);
        return 'changed' as const;
      });
    },
  };
}
