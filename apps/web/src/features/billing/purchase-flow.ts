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
type Vendor = ReturnType<typeof createCheckoutVendor>;
type Discovery = Awaited<ReturnType<typeof discoverCheckout>>;
export type PurchaseDestination =
  | { readonly kind: 'redirect'; readonly url: string }
  | { readonly kind: 'pending' };
const pending = { kind: 'pending' } as const;

/** One bounded recovery step over the stable, account-fenced purchase identity. */
export function createPurchaseFlow(input: {
  readonly admit: (
    subject: Subject,
  ) => Promise<{ readonly purchase: Purchase }>;
  readonly store: Store;
  readonly vendor: Vendor;
  readonly discover: (purchase: Purchase) => Promise<Discovery>;
}) {
  return async (subject: Subject): Promise<PurchaseDestination> => {
    const admitted = await input.admit(subject);
    const { purchase, work, claimId } = await input.store.recover(
      subject,
      admitted.purchase.id,
    );
    if (work === 'refuse' || work === 'cleanup')
      throw createAppError('AUTHORIZATION');
    let result: Discovery;
    switch (work) {
      case 'create':
        if (claimId === null) throw createAppError('CONFLICT');
        result = await input.vendor.create(purchase, claimId);
        break;
      case 'retrieve':
        result = await input.vendor.retrieve(purchase);
        break;
      case 'expire':
        result = await input.vendor.expire(purchase);
        break;
      case 'discover':
        result = await input.discover(purchase);
        break;
      case 'wait':
      case 'none':
      case 'synchronize':
        return pending;
    }
    switch (result.kind) {
      case 'refuse':
        throw createAppError('CONFLICT');
      case 'unknown':
        if (work === 'create' && claimId !== null)
          await input.store.record(subject, purchase.id, {
            kind: 'unknown',
            claimId,
          });
        return pending;
      case 'searched':
        await input.store.record(subject, purchase.id, result);
        return pending;
      case 'observed': {
        const recorded = await input.store.record(subject, purchase.id, {
          kind: 'observe',
          session: result.session,
        });
        if (recorded === 'refuse') throw createAppError('CONFLICT');
        // Recording may lose a race to account closure or a newer observation.
        const current = await input.store.read(subject, purchase.id);
        return result.session.kind === 'open' &&
          result.url !== null &&
          current.state.kind === 'open' &&
          current.state.sessionId === result.session.id &&
          current.state.customerId === result.session.customerId
          ? { kind: 'redirect', url: result.url }
          : pending;
      }
    }
  };
}
