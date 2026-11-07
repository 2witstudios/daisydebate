import type { Database } from '@daisy/db';
import { createAppError } from '@daisy/errors';
import { noCleanupEffects } from '@daisy/protocol/billing';
import { createLocalCleanupDelivery } from './cleanup-local-delivery';
import { createCleanupIdentityDelivery } from './cleanup-identity-delivery';
import { createCleanupDiscoveryDelivery } from './cleanup-discovery-delivery';
import { createCleanupDiscoveryReader } from './cleanup-discovery-reader';
import { createCleanupSubscriptionDelivery } from './cleanup-subscription-delivery';
import { createCleanupInvoiceDelivery } from './cleanup-invoice-delivery';
import { createCleanupObservationDelivery } from './cleanup-observation-delivery';
import { createCleanupCustomerDelivery } from './cleanup-customer-delivery';
import type { CleanupDeliveryRequest } from './cleanup-delivery-request';
import type { CleanupVendorPort } from './cleanup-vendor';
import type { createInvoicePassReader } from './invoice-pass-reader';
import type { createPaymentObservationReader } from './payment-observation-reader';
type Store = Pick<
  ReturnType<Database['billingCleanup']>,
  | 'claim'
  | 'inspect'
  | 'resources'
  | 'record'
  | 'frozenOffer'
  | 'retainInvoiceIdentity'
  | 'recordInvoices'
  | 'retainInvoicePage'
  | 'deferInvoicePage'
  | 'invoicePassStep'
  | 'selectedObservation'
  | 'retainObservation'
  | 'recordPayments'
  | 'observations'
  | 'revisitPayment'
  | 'recordPayment'
>;
type Vendor = {
  readonly mode: 'test' | 'live';
  readonly port: CleanupVendorPort;
  readonly readPass: ReturnType<typeof createInvoicePassReader>;
  readonly readPayment: ReturnType<typeof createPaymentObservationReader>;
};

/** One account consumes at most one bounded step; Stripe alone owns its typed job progress/completion. */
export function createBillingCleanupDelivery(input: {
  readonly store: Store;
  readonly vendor: Vendor | null;
  readonly nextId: () => string;
  readonly retryAt: (now: string, attempts: number) => string;
}) {
  let stopped = false;
  const running = () => !stopped;
  const local = createLocalCleanupDelivery({ store: input.store, running });
  const vendor = input.vendor;
  const delivery = vendor
    ? {
        identity: createCleanupIdentityDelivery({
          ...vendor,
          store: input.store,
          running,
        }),
        discovery: createCleanupDiscoveryDelivery({
          store: input.store,
          read: createCleanupDiscoveryReader(vendor),
          running,
        }),
        subscription: createCleanupSubscriptionDelivery({
          ...vendor,
          store: input.store,
          running,
        }),
        invoice: createCleanupInvoiceDelivery({
          ...vendor,
          store: input.store,
          nextId: input.nextId,
          running,
        }),
        observation: createCleanupObservationDelivery({
          store: input.store,
          read: vendor.readPayment,
          running,
        }),
        customer: createCleanupCustomerDelivery({
          ...vendor,
          store: input.store,
          running,
        }),
      }
    : null;
  const observation = async (request: CleanupDeliveryRequest) => {
    if (!delivery) return 'idle' as const;
    const invoice = await delivery.invoice(request);
    if (invoice !== 'unhandled') return invoice;
    return stopped ? ('idle' as const) : delivery.observation(request);
  };
  const network = async (request: CleanupDeliveryRequest) => {
    if (!delivery)
      return input.store.record(request.jobId, {
        kind: 'failure',
        claimId: request.claimId,
        work: request.work,
        retryAt: request.retryAt,
      });
    const { work } = request;
    if (work.kind === 'invoice-identity') return delivery.identity(request);
    if (work.kind === 'delete') return delivery.customer(request);
    if (
      work.scan.kind === 'page' &&
      (work.lane === 'subscriptions' || work.lane === 'invoices')
    )
      return delivery.discovery(request);
    if (work.lane === 'subscriptions') return delivery.subscription(request);
    if (work.lane === 'invoices') return delivery.invoice(request);
    if (work.lane === 'observations') return observation(request);
    throw createAppError('INVARIANT');
  };
  async function dispatch(request: CleanupDeliveryRequest) {
    const result = await local(request);
    if (result !== 'unhandled' || stopped)
      return result === 'unhandled' ? ('idle' as const) : result;
    const advanced = await network(request);
    if (advanced === 'unhandled') throw createAppError('INVARIANT');
    return advanced;
  }
  return {
    async deliver(jobId: string) {
      if (stopped) return 'idle' as const;
      const claimed = await input.store.claim(jobId);
      if (
        stopped ||
        claimed.kind !== 'claimed' ||
        claimed.state.kind === 'acknowledged' ||
        !claimed.state.claim
      )
        return 'idle' as const;
      const request = {
        jobId,
        claimId: claimed.state.claim.id,
        work: claimed.work,
        retryAt: input.retryAt(claimed.state.claim.claimedAt, claimed.attempts),
      };
      // This projection chooses the local path only. The record transaction independently rechecks every current fact.
      if (noCleanupEffects(claimed.facts.effects))
        return input.store.record(jobId, {
          kind: 'no-effects',
          claimId: request.claimId,
          work: request.work,
        });
      return dispatch(request);
    },
    stop() {
      stopped = true;
    },
  };
}
