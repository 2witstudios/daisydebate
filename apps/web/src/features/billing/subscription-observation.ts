import { z } from 'zod';
import {
  subscriptionEvidenceSchema,
  type SubscriptionEvidence,
  type SubscriptionPeriod,
} from '@daisy/protocol/billing';

import {
  identitySchema,
  subscriptionOwnerSchema,
  type SubscriptionOwner,
  subscriptionSchema,
  invoiceSchema,
  type BillingSubscriptionIdentity,
} from './subscription-vendor-facts';
export type { BillingSubscriptionIdentity } from './subscription-vendor-facts';

type Invoice = z.infer<typeof invoiceSchema>;
type PaidPeriod = Extract<SubscriptionEvidence['settlement'], { kind: 'paid' }>;
export type SubscriptionObservation =
  | { readonly kind: 'refuse' }
  | {
      readonly kind: 'observed';
      readonly evidence: SubscriptionEvidence;
      readonly cancelAtPeriodEnd: boolean;
      readonly cancelAt: string | null;
    };
const refuse = { kind: 'refuse' } as const;
const iso = (value: number) => new Date(value * 1000).toISOString();

function verifiedSubscription(
  identity: BillingSubscriptionIdentity,
  value: unknown,
) {
  const expected = identitySchema.safeParse(identity);
  if (!expected.success) return null;
  const { vendorSubscriptionId, customerId, priceId, mode } = expected.data;
  return readOwnedSubscription(
    { vendorSubscriptionId, customerId, priceId, mode },
    value,
  );
}

/** Original offer ownership remains available after local subscription/grant erasure. */
export function readOwnedSubscription(
  identity: SubscriptionOwner,
  value: unknown,
) {
  const expected = subscriptionOwnerSchema.safeParse(identity);
  const parsed = subscriptionSchema.safeParse(value);
  if (!expected.success || !parsed.success) return null;
  const sub = parsed.data;
  const item = sub.items.data[0]!;
  return sub.id === identity.vendorSubscriptionId &&
    sub.customer === identity.customerId &&
    sub.livemode === (identity.mode === 'live') &&
    item.price.livemode === sub.livemode &&
    item.price.id === identity.priceId
    ? sub
    : null;
}

/** Validate ownership before following any expandable vendor reference. */
export function subscriptionInvoiceReference(
  identity: BillingSubscriptionIdentity,
  value: unknown,
) {
  const sub = verifiedSubscription(identity, value);
  return sub ? { invoiceId: sub.latest_invoice } : null;
}

export function validBillingSubscriptionIdentity(
  identity: BillingSubscriptionIdentity,
) {
  return identitySchema.safeParse(identity).success;
}

function paidStatusIsCoherent(invoice: Invoice) {
  return (
    invoice.status !== 'paid' ||
    (invoice.amount_remaining === 0 &&
      invoice.status_transitions.paid_at !== null)
  );
}
function verifiedInvoice(
  value: unknown,
  identity: BillingSubscriptionIdentity,
  itemId: string,
): Invoice | null {
  const parsed = invoiceSchema.safeParse(value);
  if (!parsed.success) return null;
  const invoice = parsed.data;
  const line = invoice.lines.data[0]!;
  return invoice.customer === identity.customerId &&
    invoice.livemode === (identity.mode === 'live') &&
    line.livemode === invoice.livemode &&
    invoice.parent.subscription_details.subscription ===
      identity.vendorSubscriptionId &&
    line.parent.subscription_item_details.subscription ===
      identity.vendorSubscriptionId &&
    line.parent.subscription_item_details.subscription_item === itemId &&
    line.pricing.price_details.price === identity.priceId &&
    paidStatusIsCoherent(invoice)
    ? invoice
    : null;
}
function invoicePeriod(
  invoice: Invoice,
  subscriptionId: string,
): SubscriptionPeriod {
  const line = invoice.lines.data[0]!;
  return {
    subscriptionId,
    startsAt: iso(line.period.start),
    endsAt: iso(line.period.end),
  };
}
function payment(
  invoice: Invoice | null,
  subscriptionId: string,
): PaidPeriod | null {
  return invoice?.status === 'paid' && invoice.lines.data[0]!.amount === 1000
    ? {
        kind: 'paid',
        invoiceId: invoice.id,
        period: invoicePeriod(invoice, subscriptionId),
      }
    : null;
}
function mostRecentPayment(
  current: PaidPeriod | null,
  previous: PaidPeriod | null,
) {
  if (!current) return previous;
  if (!previous) return current;
  return Date.parse(current.period.endsAt) >= Date.parse(previous.period.endsAt)
    ? current
    : previous;
}

type ObservationInput = {
  readonly identity: BillingSubscriptionIdentity;
  readonly subscription: unknown;
  readonly latestInvoice: unknown;
  readonly latestPaidInvoice: unknown;
};
type Subscription = z.infer<typeof subscriptionSchema>;
function optionalInvoice(
  value: unknown,
  identity: BillingSubscriptionIdentity,
  itemId: string,
) {
  if (value === null) return null;
  return verifiedInvoice(value, identity, itemId) ?? undefined;
}
function verifiedInvoices(input: ObservationInput, sub: Subscription) {
  const itemId = sub.items.data[0]!.id;
  const latest = optionalInvoice(input.latestInvoice, input.identity, itemId);
  const previous = optionalInvoice(
    input.latestPaidInvoice,
    input.identity,
    itemId,
  );
  if (latest === undefined || previous === undefined) return null;
  if (sub.latest_invoice !== (latest?.id ?? null)) return null;
  if (previous && previous.status !== 'paid') return null;
  return { latest, previous };
}
function failedCollection(invoice: Invoice) {
  return (
    invoice.status === 'open' &&
    invoice.billing_reason === 'subscription_cycle' &&
    invoice.attempted &&
    invoice.attempt_count > 0 &&
    invoice.amount_remaining > 0 &&
    invoice.lines.data[0]!.amount === 1000
  );
}
function observedSettlement(
  sub: Subscription,
  latest: Invoice | null,
  paid: PaidPeriod | null,
): SubscriptionEvidence['settlement'] {
  if (!paid) return { kind: 'unpaid' };
  if (!latest || sub.status !== 'past_due' || !failedCollection(latest))
    return paid;
  const item = sub.items.data[0]!;
  const failed = invoicePeriod(latest, paid.period.subscriptionId);
  if (
    failed.startsAt !== paid.period.endsAt ||
    failed.startsAt !== iso(item.current_period_start) ||
    failed.endsAt !== iso(item.current_period_end)
  )
    return paid;
  return {
    kind: 'renewal_failed',
    invoiceId: latest.id,
    period: failed,
    previous: { invoiceId: paid.invoiceId, period: paid.period },
  };
}

/** Strip vendor payloads to verified billing facts; never store customer/contact/card data. */
export function normalizeSubscriptionObservation(
  input: ObservationInput,
): SubscriptionObservation {
  const sub = verifiedSubscription(input.identity, input.subscription);
  if (!sub) return refuse;
  const invoices = verifiedInvoices(input, sub);
  if (!invoices) return refuse;
  const paid = mostRecentPayment(
    payment(invoices.latest, input.identity.subscriptionId),
    payment(invoices.previous, input.identity.subscriptionId),
  );
  const evidence = subscriptionEvidenceSchema.safeParse({
    lifecycle: sub.status,
    settlement: observedSettlement(sub, invoices.latest, paid),
  });
  return evidence.success
    ? {
        kind: 'observed',
        evidence: evidence.data,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        cancelAt: sub.cancel_at === null ? null : iso(sub.cancel_at),
      }
    : refuse;
}
