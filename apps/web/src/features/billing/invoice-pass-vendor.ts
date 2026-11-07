import type Stripe from 'stripe';

export type InvoicePassReadPort = {
  readonly payments: (request: {
    readonly invoice: string;
    readonly limit: 1 | 20;
    readonly starting_after?: string;
  }) => Promise<unknown>;
  readonly invoice: (id: string) => Promise<unknown>;
};

/** Await exactly one page; no auto-pagination, filters, background expansion or vendor I/O under locks. */
export function stripeInvoicePassReadPort(
  stripe: Pick<Stripe, 'invoicePayments' | 'invoices'>,
): InvoicePassReadPort {
  const options = {
    apiVersion: '2026-10-28.endive',
    timeout: 5_000,
    maxNetworkRetries: 0,
  } as const;
  return {
    payments: (request) =>
      stripe.invoicePayments.list(
        {
          ...request,
          expand: [
            'data.invoice',
            'data.payment.payment_intent.latest_charge',
            'data.payment.charge',
          ],
        },
        options,
      ),
    invoice: (id) => stripe.invoices.retrieve(id, {}, options),
  };
}
