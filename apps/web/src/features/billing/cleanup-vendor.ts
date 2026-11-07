import type Stripe from 'stripe';
import {
  stripeInvoicePassReadPort,
  type InvoicePassReadPort,
} from './invoice-pass-vendor';

type CustomerPage = {
  readonly customer: string;
  readonly afterId: string | null;
};
export type CleanupVendorPort = InvoicePassReadPort & {
  readonly subscriptions: (page: CustomerPage) => Promise<unknown>;
  readonly invoices: (page: CustomerPage) => Promise<unknown>;
  readonly subscription: (id: string) => Promise<unknown>;
  readonly customer: (id: string) => Promise<unknown>;
  readonly cancelSubscription: (id: string) => Promise<unknown>;
  readonly deleteCustomer: (id: string) => Promise<unknown>;
};

/** Caller owns frozen routing and current claims; a raw response alone supplies no completion authority. */
export function stripeCleanupPort(
  stripe: Pick<
    Stripe,
    'subscriptions' | 'invoices' | 'invoicePayments' | 'customers'
  >,
): CleanupVendorPort {
  const options = {
    apiVersion: '2026-10-28.endive',
    timeout: 5000,
    maxNetworkRetries: 0,
  } as const;
  const page = ({ customer, afterId }: CustomerPage) => ({
    customer,
    limit: 20,
    ...(afterId === null ? {} : { starting_after: afterId }),
  });
  return {
    ...stripeInvoicePassReadPort(stripe),
    subscriptions: (request) =>
      stripe.subscriptions.list({ ...page(request), status: 'all' }, options),
    invoices: (request) => stripe.invoices.list(page(request), options),
    subscription: (id) => stripe.subscriptions.retrieve(id, {}, options),
    customer: (id) => stripe.customers.retrieve(id, {}, options),
    // Closure does not authorize a new final invoice or an invented proration/refund.
    cancelSubscription: (id) =>
      stripe.subscriptions.cancel(
        id,
        { invoice_now: false, prorate: false },
        options,
      ),
    deleteCustomer: (id) => stripe.customers.del(id, {}, options),
  };
}
