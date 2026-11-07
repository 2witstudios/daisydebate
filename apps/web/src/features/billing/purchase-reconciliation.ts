import type { Database } from '@daisy/db';
import { createAppError } from '@daisy/errors';
import type { Purchase } from '@daisy/protocol/billing';
import type { createCheckoutVendor } from './checkout-vendor';
import type { discoverCheckout } from './checkout-discovery';

type Store = ReturnType<Database['billingPurchaseRecovery']>;
type Inspection = NonNullable<Awaited<ReturnType<Store['inspect']>>>;
type Observation = Awaited<ReturnType<typeof discoverCheckout>>;
type Vendor = Pick<
  ReturnType<typeof createCheckoutVendor>,
  'retrieve' | 'expire'
>;

function closedPurchaseWork(state: Purchase['state']) {
  switch (state.kind) {
    case 'creating':
    case 'unknown':
      return 'discover';
    case 'open':
      return 'expire';
    case 'complete':
      return 'retrieve';
    case 'admitted':
    case 'expired':
    case 'abandoned':
      return 'none';
  }
}

/** Recovery has no creation port: an old attempt can discover effects, never authorize a fresh purchase. */
export function createPurchaseReconciliation(input: {
  readonly store: Store;
  readonly vendor: Vendor;
  readonly discover: (purchase: Purchase) => Promise<Observation>;
  readonly mode: 'test' | 'live';
  readonly failed: (error: unknown, stage: 'discover' | 'recover') => void;
}) {
  let afterId: string | undefined;
  let stopped = false;
  const observe = (inspection: Inspection): Promise<Observation | null> => {
    const { purchase } = inspection;
    const work =
      inspection.work === 'cleanup'
        ? closedPurchaseWork(purchase.state)
        : inspection.work;
    if (work === 'discover') return input.discover(purchase);
    if (work === 'retrieve') return input.vendor.retrieve(purchase);
    if (work === 'expire') return input.vendor.expire(purchase);
    return Promise.resolve(null);
  };
  async function recover(purchaseId: string) {
    const inspection = await input.store.inspect(purchaseId);
    if (!inspection || stopped) return;
    if (inspection.purchase.mode !== input.mode)
      throw createAppError('CONFLICT');
    const observed = await observe(inspection);
    if (observed === null) return;
    if (observed.kind === 'refuse' || observed.kind === 'unknown')
      throw createAppError('INFRASTRUCTURE');
    // Preserve a possible financial effect even when drain began during its bounded read.
    const result = await input.store.record(
      purchaseId,
      observed.kind === 'observed'
        ? { kind: 'observe', session: observed.session }
        : observed,
    );
    if (result === 'refuse' || result === 'missing')
      throw createAppError('CONFLICT');
  }
  return {
    async run() {
      if (stopped) return;
      try {
        const page = await input.store.purchases({
          mode: input.mode,
          limit: 3,
          ...(afterId === undefined ? {} : { afterId }),
        });
        for (const { purchaseId } of page.rows) {
          if (stopped) return;
          try {
            await recover(purchaseId);
          } catch (error) {
            input.failed(error, 'recover');
          }
        }
        afterId = page.exhausted ? undefined : (page.afterId ?? undefined);
      } catch (error) {
        input.failed(error, 'discover');
      }
    },
    stop() {
      stopped = true;
    },
  };
}
