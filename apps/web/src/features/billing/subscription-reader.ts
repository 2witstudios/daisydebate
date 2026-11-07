import type Stripe from 'stripe';
import { z } from 'zod';
import {
  normalizeSubscriptionObservation,
  subscriptionInvoiceReference,
  validBillingSubscriptionIdentity,
  type BillingSubscriptionIdentity,
  type SubscriptionObservation,
} from './subscription-observation';

export type SubscriptionReadPort = {
  readonly subscription: (id: string) => Promise<unknown>;
  readonly invoice: (id: string) => Promise<unknown>;
  readonly latestPaidInvoice: (
    subscriptionId: string,
    customerId: string,
  ) => Promise<unknown>;
};
const latestPaid = z.object({
  object: z.literal('list'),
  has_more: z.boolean(),
  data: z.array(z.unknown()).max(1),
});

/** Each SDK request is bounded; the three reads fit inside the 30-second durable claim. */
export function stripeSubscriptionReadPort(
  stripe: Pick<Stripe, 'subscriptions' | 'invoices'>,
): SubscriptionReadPort {
  const options = {
    apiVersion: '2026-10-28.endive',
    timeout: 5_000,
    maxNetworkRetries: 0,
  } as const;
  return {
    subscription: (id) => stripe.subscriptions.retrieve(id, {}, options),
    invoice: (id) => stripe.invoices.retrieve(id, {}, options),
    latestPaidInvoice: (subscription, customer) =>
      stripe.invoices.list(
        { subscription, customer, status: 'paid', limit: 1 },
        options,
      ),
  };
}

/** Transport failures are not nonpayment; raw SDK errors and payloads never leave this boundary. */
export async function readSubscriptionObservation(
  port: SubscriptionReadPort,
  identity: BillingSubscriptionIdentity,
): Promise<SubscriptionObservation | { readonly kind: 'retry' }> {
  if (!validBillingSubscriptionIdentity(identity)) return { kind: 'refuse' };
  try {
    const subscription = await port.subscription(identity.vendorSubscriptionId);
    const reference = subscriptionInvoiceReference(identity, subscription);
    if (!reference) return { kind: 'refuse' };
    const [invoice, paid] = await Promise.allSettled([
      reference.invoiceId === null
        ? Promise.resolve(null)
        : port.invoice(reference.invoiceId),
      port.latestPaidInvoice(
        identity.vendorSubscriptionId,
        identity.customerId,
      ),
    ]);
    if (invoice.status === 'rejected' || paid.status === 'rejected')
      return { kind: 'retry' };
    const page = latestPaid.safeParse(paid.value);
    if (!page.success) return { kind: 'refuse' };
    return normalizeSubscriptionObservation({
      identity,
      subscription,
      latestInvoice: invoice.value,
      latestPaidInvoice: page.data.data[0] ?? null,
    });
  } catch {
    return { kind: 'retry' };
  }
}
