import type { Database } from '@daisy/db';
import { createAppError } from '@daisy/errors';
import type { Purchase } from '@daisy/protocol/billing';
import type { createCheckoutVendor } from './checkout-vendor';
import type { discoverCheckout } from './checkout-discovery';

type Subject = { readonly userId: string; readonly actorId: string };
type Store = Pick<
  ReturnType<Database['billingPurchases']>,
  'recover' | 'record' | 'read'
>;
type Recovery = Awaited<ReturnType<Store['recover']>>;
type Discovery = Awaited<ReturnType<typeof discoverCheckout>>;
type Dependencies = {
  readonly admit: (
    subject: Subject,
  ) => Promise<{ readonly purchase: Purchase }>;
  readonly store: Store;
  readonly vendor: ReturnType<typeof createCheckoutVendor>;
  readonly discover: (purchase: Purchase) => Promise<Discovery>;
};
export type PurchaseDestination =
  | { readonly kind: 'redirect'; readonly url: string }
  | { readonly kind: 'pending' };
const pending = { kind: 'pending' } as const;

async function readPurchase(
  input: Dependencies,
  recovery: Recovery,
): Promise<Discovery | null> {
  const { purchase, work, claimId } = recovery;
  switch (work) {
    case 'refuse':
    case 'cleanup':
      throw createAppError('AUTHORIZATION');
    case 'create':
      if (claimId === null) throw createAppError('CONFLICT');
      return input.vendor.create(purchase, claimId);
    case 'retrieve':
      return input.vendor.retrieve(purchase);
    case 'expire':
      return input.vendor.expire(purchase);
    case 'discover':
      return input.discover(purchase);
    case 'wait':
    case 'none':
    case 'synchronize':
      return null;
  }
}

function currentDestination(
  result: Extract<Discovery, { kind: 'observed' }>,
  current: Purchase,
): PurchaseDestination {
  return result.session.kind === 'open' &&
    result.url !== null &&
    current.state.kind === 'open' &&
    current.state.sessionId === result.session.id &&
    current.state.customerId === result.session.customerId
    ? { kind: 'redirect', url: result.url }
    : pending;
}

async function recordPurchase(
  store: Store,
  subject: Subject,
  recovery: Recovery,
  result: Discovery,
): Promise<PurchaseDestination> {
  const { purchase, work, claimId } = recovery;
  switch (result.kind) {
    case 'refuse':
      throw createAppError('CONFLICT');
    case 'unknown':
      if (work === 'create' && claimId !== null)
        await store.record(subject, purchase.id, { kind: 'unknown', claimId });
      return pending;
    case 'searched':
      await store.record(subject, purchase.id, result);
      return pending;
    case 'observed': {
      const recorded = await store.record(subject, purchase.id, {
        kind: 'observe',
        session: result.session,
      });
      if (recorded === 'refuse') throw createAppError('CONFLICT');
      // Recording may lose a race to account closure or a newer observation.
      return currentDestination(result, await store.read(subject, purchase.id));
    }
  }
}

/** One bounded recovery step over the stable, account-fenced purchase identity. */
export function createPurchaseFlow(input: Dependencies) {
  return async (subject: Subject): Promise<PurchaseDestination> => {
    const admitted = await input.admit(subject);
    const recovery = await input.store.recover(subject, admitted.purchase.id);
    const result = await readPurchase(input, recovery);
    return result === null
      ? pending
      : recordPurchase(input.store, subject, recovery, result);
  };
}
