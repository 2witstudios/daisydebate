import type { Database } from '@daisy/db';
import { createAppError } from '@daisy/errors';
import { observedTerms } from './subscription-observation';
import {
  readClubSubscriptionObservation,
  readSubscriptionObservation,
  type SubscriptionReadPort,
} from './subscription-reader';

type Store = ReturnType<Database['billingSynchronization']>;
type FailureStage = 'receipts' | 'discover' | 'synchronize';

/** Each tick advances bounded keyset pages. Failed identities remain durable and cannot starve later pages. */
export function createSubscriptionReconciliation(input: {
  readonly store: Store;
  readonly vendor: SubscriptionReadPort;
  readonly mode: 'test' | 'live';
  readonly failed: (error: unknown, stage: FailureStage) => void;
}) {
  let receiptCursor: string | undefined;
  let customerCursor: string | undefined;
  let stopped = false;
  /** Read afresh after every await: stop() lands between them. */
  const isStopped = () => stopped;
  // A read already in flight stays bounded; drain admits none of its follow-up SDK calls.
  const readIfRunning = (read: () => Promise<unknown>) =>
    isStopped() ? Promise.reject(createAppError('CONFLICT')) : read();
  const vendor: SubscriptionReadPort = {
    subscription: (id) => readIfRunning(() => input.vendor.subscription(id)),
    invoice: (id) => readIfRunning(() => input.vendor.invoice(id)),
    latestPaidInvoice: (subscriptionId, customerId) =>
      readIfRunning(() =>
        input.vendor.latestPaidInvoice(subscriptionId, customerId),
      ),
    paidInvoices: (subscriptionId, customerId, startingAfter) =>
      readIfRunning(() =>
        input.vendor.paidInvoices(subscriptionId, customerId, startingAfter),
      ),
  };

  const receipts = async (): Promise<number> => {
    const page = await input.store.receipts({
      mode: input.mode,
      limit: 25,
      ...(receiptCursor ? { afterId: receiptCursor } : {}),
    });
    for (const receipt of page.rows) {
      if (isStopped()) return page.rows.length;
      try {
        const { eventId, customerId, mode } = receipt;
        await input.store.receive({ eventId, customerId, mode });
      } catch (error) {
        input.failed(error, 'receipts');
      }
    }
    receiptCursor = page.exhausted ? undefined : (page.afterId ?? undefined);
    return page.rows.length;
  };
  const synchronize = async (customerId: string) => {
    const claim = await input.store.claim(customerId);
    if (!claim || isStopped()) return;
    if (claim.mode !== input.mode) throw createAppError('CONFLICT');
    const identity = {
      subscriptionId: claim.subscriptionId,
      vendorSubscriptionId: claim.vendorSubscriptionId,
      customerId: claim.vendorCustomerId,
      mode: input.mode,
      priceId: claim.priceId,
    };
    // A Club plan (ADR 0148) reads its seat count and prorated invoices.
    const observed =
      claim.owner.kind === 'organization'
        ? await readClubSubscriptionObservation(vendor, identity)
        : await readSubscriptionObservation(vendor, identity);
    if (isStopped()) return;
    if (observed.kind === 'observed') {
      await input.store.apply(
        claim,
        observed.evidence,
        observedTerms(observed),
      );
    } else {
      await input.store.retry(claim);
      input.failed(
        createAppError(
          observed.kind === 'retry' ? 'INFRASTRUCTURE' : 'VALIDATION',
        ),
        'synchronize',
      );
    }
  };
  const customers = async (): Promise<number> => {
    const page = await input.store.customers({
      mode: input.mode,
      limit: 3,
      ...(customerCursor ? { afterId: customerCursor } : {}),
    });
    for (const { customerId } of page.rows) {
      if (isStopped()) return page.rows.length;
      try {
        await synchronize(customerId);
      } catch (error) {
        input.failed(error, 'synchronize');
      }
    }
    customerCursor = page.exhausted ? undefined : (page.afterId ?? undefined);
    return page.rows.length;
  };
  return {
    /** One pass; returns how many receipts and customers it handled. */
    async run(): Promise<number> {
      if (isStopped()) return 0;
      let handled = 0;
      try {
        handled += await receipts();
      } catch (error) {
        input.failed(error, 'receipts');
      }
      if (isStopped()) return handled;
      try {
        handled += await customers();
      } catch (error) {
        input.failed(error, 'discover');
      }
      return handled;
    },
    stop() {
      stopped = true;
    },
  };
}
