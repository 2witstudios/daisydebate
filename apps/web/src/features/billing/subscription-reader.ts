import type Stripe from 'stripe';
import { z } from 'zod';
import {
  clubInvoiceReference,
  normalizeClubSubscriptionObservation,
  type ClubSubscriptionObservation,
} from './club-subscription-observation';
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
  /** Paid invoices newest first, a page at a time: a Club looks past its seat-change invoices. */
  readonly paidInvoices: (
    subscriptionId: string,
    customerId: string,
    startingAfter?: string,
  ) => Promise<unknown>;
};
/** Stripe's largest page, and how many a Club read follows to find its settling invoice. */
const clubPaidInvoicePage = 100;
const clubPaidInvoicePages = 3;
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
    paidInvoices: (subscription, customer, startingAfter) =>
      stripe.invoices.list(
        {
          subscription,
          customer,
          status: 'paid',
          limit: clubPaidInvoicePage,
          ...(startingAfter ? { starting_after: startingAfter } : {}),
        },
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

const paidPage = z.object({
  object: z.literal('list'),
  has_more: z.boolean(),
  data: z.array(z.unknown()).max(clubPaidInvoicePage),
});

/** A Club plan's read (ADR 0148): the same bounds, its own normaliser. */
export async function readClubSubscriptionObservation(
  port: SubscriptionReadPort,
  identity: BillingSubscriptionIdentity,
): Promise<ClubSubscriptionObservation | { readonly kind: 'retry' }> {
  if (!validBillingSubscriptionIdentity(identity)) return { kind: 'refuse' };
  try {
    const subscription = await port.subscription(identity.vendorSubscriptionId);
    const reference = clubInvoiceReference(identity, subscription);
    if (!reference) return { kind: 'refuse' };
    const [invoice, paid] = await Promise.allSettled([
      reference.invoiceId === null
        ? Promise.resolve(null)
        : port.invoice(reference.invoiceId),
      port.paidInvoices(identity.vendorSubscriptionId, identity.customerId),
    ]);
    if (invoice.status === 'rejected' || paid.status === 'rejected')
      return { kind: 'retry' };
    // Seat increases add paid invoices that settle nothing; follow the pages
    // (bounded) until the period's settling invoice is among them.
    const data: unknown[] = [];
    let next: unknown = paid.value;
    for (let pages = 1; ; pages += 1) {
      const page = paidPage.safeParse(next);
      if (!page.success) return { kind: 'refuse' };
      data.push(...page.data.data);
      const observed = normalizeClubSubscriptionObservation({
        identity,
        subscription,
        latestInvoice: invoice.value,
        paidInvoices: { hasMore: page.data.has_more, data },
      });
      const last = page.data.data.at(-1) as { id?: unknown } | undefined;
      if (
        observed.kind === 'observed' ||
        !page.data.has_more ||
        pages >= clubPaidInvoicePages ||
        typeof last?.id !== 'string'
      )
        return observed;
      next = await port.paidInvoices(
        identity.vendorSubscriptionId,
        identity.customerId,
        last.id,
      );
    }
  } catch {
    return { kind: 'retry' };
  }
}
