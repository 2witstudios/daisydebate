import type { Database } from '@daisy/db';
import type { CleanupDeliveryRequest } from './cleanup-delivery-request';
import type { createCleanupDiscoveryReader } from './cleanup-discovery-reader';
type Store = Pick<
  ReturnType<Database['billingCleanup']>,
  | 'inspect'
  | 'record'
  | 'retainInvoicePage'
  | 'deferInvoicePage'
  | 'recordInvoices'
>;

/** Positive invoice facts survive an incomplete read; only a complete page can advance discovery. */
export function createCleanupDiscoveryDelivery(input: {
  readonly store: Store;
  readonly read: ReturnType<typeof createCleanupDiscoveryReader>;
  readonly running: () => boolean;
}) {
  return async (request: CleanupDeliveryRequest) => {
    const { jobId, claimId, work, retryAt } = request;
    if (!isDiscoveryPage(work)) return 'unhandled' as const;
    if (!input.running()) return 'idle' as const;
    const current = await input.store.inspect(jobId, claimId, work);
    if (current.kind !== 'current') return 'idle' as const;
    const fail = () =>
      input.store.record(jobId, { kind: 'failure', claimId, work, retryAt });
    if (current.facts.route.kind !== 'owned') return fail();
    const { mode, customerId } = current.facts.route;
    const page = await input.read({ mode, customerId }, work);
    if (!input.running()) return 'idle' as const;
    if (page.kind === 'unavailable') return fail();
    if (page.kind === 'subscription-page')
      return input.store.record(jobId, {
        kind: 'page',
        claimId,
        work,
        ids: page.ids,
        more: page.more,
      });
    return retainInvoices(request, current.userId, page);
  };
  async function retainInvoices(
    { jobId, claimId, work, retryAt }: CleanupDeliveryRequest,
    userId: string,
    page: Extract<
      Awaited<ReturnType<typeof input.read>>,
      { kind: 'invoice-page' | 'invoice-reads' }
    >,
  ) {
    const result =
      page.kind === 'invoice-page'
        ? await input.store.retainInvoicePage(jobId, claimId, work, {
            reads: page.reads,
            more: page.more,
          })
        : await input.store.deferInvoicePage(jobId, claimId, work, {
            reads: page.reads,
            retryAt,
          });
    if (result !== 'idle' || page.reads.length === 0 || !input.running())
      return result;
    // A newly rotated job has no old cursor authority, but actual owned late facts still belong to the closed account.
    const retained = await input.store.recordInvoices(userId, page.reads);
    return retained === 'recorded' ? ('reopened' as const) : ('idle' as const);
  }
}

function isDiscoveryPage(work: CleanupDeliveryRequest['work']) {
  return (
    work.kind === 'scan' &&
    work.scan.kind === 'page' &&
    (work.lane === 'subscriptions' || work.lane === 'invoices')
  );
}
