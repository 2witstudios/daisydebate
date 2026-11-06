import type { InvoicePass } from '@daisy/protocol/billing';
import type { createCleanupInvoiceDelivery } from './cleanup-invoice-delivery';
import { facts, claimId, binding } from './invoice-pass-reader.test-support';

type Input = Parameters<typeof createCleanupInvoiceDelivery>[0];
type Request = Parameters<ReturnType<typeof createCleanupInvoiceDelivery>>[0];
export const current: Extract<
  Awaited<ReturnType<Input['store']['inspect']>>,
  { kind: 'current' }
> = {
  kind: 'current',
  userId: 'u'.repeat(24),
  closedAt: facts.closedAt,
  now: facts.now,
  attempts: 0,
  facts: {
    route: {
      kind: 'owned',
      mode: binding.mode,
      customerId: binding.customerId,
    },
    effects: {
      mappedCustomers: 1,
      possiblePurchases: 1,
      retainedFinancialRoutes: 1,
      owedFinancialEffects: true,
    },
  },
};
export const request = (active: InvoicePass | null): Request => ({
  jobId: 'j'.repeat(24),
  claimId,
  retryAt: new Date(Date.parse(facts.now) + 60000).toISOString(),
  work: {
    kind: 'scan',
    lane: 'invoices',
    scan: {
      kind: 'selected',
      id: binding.invoiceId,
      rest: [],
      lastId: binding.invoiceId,
      more: false,
      detail: { kind: 'invoice-payments', pass: active },
    },
  },
});
export const unexpected = async () => {
  throw Error('Unexpected store path');
};
export const store = (): Input['store'] => ({
  inspect: async () => current,
  selectedObservation: unexpected,
  retainObservation: unexpected,
  record: unexpected,
  recordInvoices: async () => 'unchanged',
  recordPayments: unexpected,
  frozenOffer: async () => ({ kind: 'unresolved' }),
  invoicePassStep: unexpected,
});
export const resources = (): Input => ({
  store: store(),
  mode: binding.mode,
  running: () => true,
  nextId: () => 'n'.repeat(24),
  port: { invoice: unexpected },
  readPass: async () => ({ kind: 'unavailable' }),
});
export function frozen(): Extract<
  Awaited<ReturnType<Input['store']['frozenOffer']>>,
  { kind: 'owned' }
> {
  if (binding.source.kind !== 'purchase')
    throw Error('Expected frozen original purchase');
  return {
    kind: 'owned',
    source: binding.source,
    owner: {
      mode: binding.mode,
      customerId: binding.customerId,
      priceId: binding.source.priceId,
      vendorSubscriptionId: binding.source.vendorSubscriptionId,
    },
  };
}
