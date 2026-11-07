import type { Database } from '@daisy/db';
import type { CleanupDeliveryRequest } from './cleanup-delivery-request';
import type { CleanupVendorPort } from './cleanup-vendor';
import { readCleanupInvoiceIdentity } from './cleanup-invoice-identity';
type Store = Pick<
  ReturnType<Database['billingCleanup']>,
  'inspect' | 'retainInvoiceIdentity' | 'recordInvoices' | 'record'
>;

/** A mode/customer is never guessed for predecessor debt; positive current owned retrieval precedes retirement. */
export function createCleanupIdentityDelivery(input: {
  readonly store: Store;
  readonly port: Pick<CleanupVendorPort, 'invoice'>;
  readonly mode: 'test' | 'live';
  readonly running: () => boolean;
}) {
  return async (request: CleanupDeliveryRequest) => {
    const { jobId, claimId, work, retryAt } = request;
    if (work.kind !== 'invoice-identity') return 'unhandled' as const;
    if (!input.running()) return 'idle' as const;
    const current = await input.store.inspect(jobId, claimId, work);
    if (current.kind !== 'current') return 'idle' as const;
    const fail = () =>
      input.store.record(jobId, { kind: 'failure', claimId, work, retryAt });
    const route = current.facts.route;
    if (route.kind !== 'owned' || route.mode !== input.mode) return fail();
    if (!input.running()) return 'idle' as const;
    return retainOwnedInvoice({ ...request, work }, current.userId, route);
  };
  async function retainOwnedInvoice(
    request: CleanupDeliveryRequest & {
      readonly work: Extract<
        CleanupDeliveryRequest['work'],
        { kind: 'invoice-identity' }
      >;
    },
    userId: string,
    route: { readonly mode: 'test' | 'live'; readonly customerId: string },
  ) {
    const { jobId, claimId, work, retryAt } = request;
    const fail = () =>
      input.store.record(jobId, { kind: 'failure', claimId, work, retryAt });
    let raw: unknown;
    try {
      raw = await input.port.invoice(work.invoiceId);
    } catch {
      return input.running() ? fail() : ('idle' as const);
    }
    if (!input.running()) return 'idle' as const;
    const read = readCleanupInvoiceIdentity(
      { mode: route.mode, customerId: route.customerId },
      raw,
    );
    if (!read || read.invoiceId !== work.invoiceId) return fail();
    const result = await input.store.retainInvoiceIdentity(
      jobId,
      claimId,
      work,
      read,
    );
    if (result === 'route-unresolved') return fail();
    if (result !== 'idle' || !input.running()) return result;
    const retained = await input.store.recordInvoices(userId, [read]);
    return retained === 'recorded' ? ('reopened' as const) : ('idle' as const);
  }
}
