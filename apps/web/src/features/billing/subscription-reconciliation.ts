import type { Database } from '@daisy/db';
import { createAppError } from '@daisy/errors';
import {
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
  readonly priceId: string;
  readonly failed: (error: unknown, stage: FailureStage) => void;
}) {
  let receiptCursor: string | undefined;
  let customerCursor: string | undefined;
  let stopped = false;

  const receipts = async () => {
    const page = await input.store.receipts({
      mode: input.mode,
      limit: 25,
      ...(receiptCursor ? { afterId: receiptCursor } : {}),
    });
    for (const receipt of page.rows) {
      if (stopped) return;
      try {
        const { eventId, customerId, mode } = receipt;
        await input.store.receive({ eventId, customerId, mode });
      } catch (error) {
        input.failed(error, 'receipts');
      }
    }
    receiptCursor = page.exhausted ? undefined : (page.afterId ?? undefined);
  };
  const synchronize = async (customerId: string) => {
    const claim = await input.store.claim(customerId);
    if (!claim || stopped) return;
    if (claim.mode !== input.mode) throw createAppError('CONFLICT');
    const observed = await readSubscriptionObservation(input.vendor, {
      subscriptionId: claim.subscriptionId,
      vendorSubscriptionId: claim.vendorSubscriptionId,
      customerId: claim.vendorCustomerId,
      mode: input.mode,
      priceId: input.priceId,
    });
    if (stopped) return;
    if (observed.kind === 'observed') {
      await input.store.apply(claim, observed.evidence);
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
  const customers = async () => {
    const page = await input.store.customers({
      mode: input.mode,
      limit: 3,
      ...(customerCursor ? { afterId: customerCursor } : {}),
    });
    for (const { customerId } of page.rows) {
      if (stopped) return;
      try {
        await synchronize(customerId);
      } catch (error) {
        input.failed(error, 'synchronize');
      }
    }
    customerCursor = page.exhausted ? undefined : (page.afterId ?? undefined);
  };
  return {
    async run() {
      if (stopped) return;
      try {
        await receipts();
      } catch (error) {
        input.failed(error, 'receipts');
      }
      if (stopped) return;
      try {
        await customers();
      } catch (error) {
        input.failed(error, 'discover');
      }
    },
    stop() {
      stopped = true;
    },
  };
}
