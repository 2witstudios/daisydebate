import {
  subscriptionEvidenceSchema,
  type SubscriptionEvidence,
  type SubscriptionPeriod,
} from '@daisy/protocol/billing';
import {
  clubInvoiceSchema,
  clubSubscriptionSchema,
  type ClubInvoice,
  type ClubSubscription,
} from './club-subscription-facts';
import type { BillingSubscriptionIdentity } from './subscription-vendor-facts';

type PaidPeriod = Extract<SubscriptionEvidence['settlement'], { kind: 'paid' }>;
export type ClubSubscriptionObservation =
  | { readonly kind: 'refuse' }
  | {
      readonly kind: 'observed';
      readonly evidence: SubscriptionEvidence;
      readonly cancelAtPeriodEnd: boolean;
      readonly cancelAt: string | null;
      /** The Club price per seat, in minor units. */
      readonly amountMinor: number;
      /** The seats Stripe bills now: an increase lands only once it is paid. */
      readonly seatCount: number;
    };
const refuse = { kind: 'refuse' } as const;
const iso = (value: number) => new Date(value * 1000).toISOString();

function ownedSubscription(
  identity: BillingSubscriptionIdentity,
  value: unknown,
): ClubSubscription | null {
  const parsed = clubSubscriptionSchema.safeParse(value);
  if (!parsed.success) return null;
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

/** Validate ownership before following the subscription's invoice reference. */
export function clubInvoiceReference(
  identity: BillingSubscriptionIdentity,
  value: unknown,
) {
  const sub = ownedSubscription(identity, value);
  return sub ? { invoiceId: sub.latest_invoice } : null;
}

/** Every line of an owned invoice names this subscription, its one item and the frozen price. */
function ownedInvoice(
  identity: BillingSubscriptionIdentity,
  itemId: string,
  value: unknown,
): ClubInvoice | null {
  const parsed = clubInvoiceSchema.safeParse(value);
  if (!parsed.success) return null;
  const invoice = parsed.data;
  const owned =
    invoice.customer === identity.customerId &&
    invoice.livemode === (identity.mode === 'live') &&
    invoice.parent.subscription_details.subscription ===
      identity.vendorSubscriptionId &&
    invoice.lines.data.every(
      (line) =>
        line.livemode === invoice.livemode &&
        line.parent.subscription_item_details.subscription ===
          identity.vendorSubscriptionId &&
        line.parent.subscription_item_details.subscription_item === itemId &&
        line.pricing.price_details.price === identity.priceId,
    ) &&
    (invoice.status !== 'paid' ||
      (invoice.amount_remaining === 0 &&
        invoice.status_transitions.paid_at !== null));
  return owned ? invoice : null;
}

/**
 * Only a creation or renewal invoice settles a period: one non-prorated line
 * whose amount is the seat price times its seats. A seat-change invoice is
 * owned but settles nothing; its seats are paid through the period it joins.
 */
function settlingLine(invoice: ClubInvoice, unitAmount: number) {
  const [line, ...rest] = invoice.lines.data;
  return line &&
    rest.length === 0 &&
    ['subscription_create', 'subscription_cycle'].includes(
      invoice.billing_reason,
    ) &&
    !line.parent.subscription_item_details.proration &&
    line.quantity >= 1 &&
    line.amount === unitAmount * line.quantity
    ? line
    : null;
}
function period(
  invoice: ClubInvoice,
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
  invoice: ClubInvoice | null,
  subscriptionId: string,
  unitAmount: number,
): PaidPeriod | null {
  return invoice?.status === 'paid' && settlingLine(invoice, unitAmount)
    ? {
        kind: 'paid',
        invoiceId: invoice.id,
        period: period(invoice, subscriptionId),
      }
    : null;
}
const newer = (left: PaidPeriod | null, right: PaidPeriod | null) => {
  if (!left) return right;
  if (!right) return left;
  return Date.parse(left.period.endsAt) >= Date.parse(right.period.endsAt)
    ? left
    : right;
};
function settlement(
  sub: ClubSubscription,
  latest: ClubInvoice | null,
  paid: PaidPeriod | null,
): SubscriptionEvidence['settlement'] {
  if (!paid) return { kind: 'unpaid' };
  const item = sub.items.data[0]!;
  const failed =
    latest !== null &&
    sub.status === 'past_due' &&
    latest.status === 'open' &&
    latest.billing_reason === 'subscription_cycle' &&
    latest.attempted &&
    latest.attempt_count > 0 &&
    latest.amount_remaining > 0 &&
    settlingLine(latest, item.price.unit_amount) !== null;
  if (!failed) return paid;
  const renewal = period(latest, paid.period.subscriptionId);
  if (
    renewal.startsAt !== paid.period.endsAt ||
    renewal.startsAt !== iso(item.current_period_start) ||
    renewal.endsAt !== iso(item.current_period_end)
  )
    return paid;
  return {
    kind: 'renewal_failed',
    invoiceId: latest.id,
    period: renewal,
    previous: { invoiceId: paid.invoiceId, period: paid.period },
  };
}

/**
 * A Club plan's verified facts (ADR 0148), stripped of vendor payloads: the
 * same evidence shape as Premium, so the same access policy and renewal grace
 * apply, plus the seat count. `paidInvoices` is a newest-first page; when its
 * settling invoice is beyond the page the observation refuses (and retries)
 * rather than read the plan as unpaid.
 */
export function normalizeClubSubscriptionObservation(input: {
  readonly identity: BillingSubscriptionIdentity;
  readonly subscription: unknown;
  readonly latestInvoice: unknown;
  readonly paidInvoices: {
    readonly hasMore: boolean;
    readonly data: readonly unknown[];
  };
}): ClubSubscriptionObservation {
  const sub = ownedSubscription(input.identity, input.subscription);
  if (!sub) return refuse;
  const item = sub.items.data[0]!;
  const latest =
    input.latestInvoice === null
      ? null
      : ownedInvoice(input.identity, item.id, input.latestInvoice);
  if (input.latestInvoice !== null && latest === null) return refuse;
  if (sub.latest_invoice !== (latest?.id ?? null)) return refuse;
  const paidPage = input.paidInvoices.data.map((value) =>
    ownedInvoice(input.identity, item.id, value),
  );
  if (paidPage.some((invoice) => invoice === null || invoice.status !== 'paid'))
    return refuse;
  const subscriptionId = input.identity.subscriptionId;
  const unit = item.price.unit_amount;
  const settledEarlier =
    paidPage
      .map((invoice) => payment(invoice, subscriptionId, unit))
      .find((value) => value !== null) ?? null;
  if (!settledEarlier && input.paidInvoices.hasMore) return refuse;
  const paid = newer(payment(latest, subscriptionId, unit), settledEarlier);
  const evidence = subscriptionEvidenceSchema.safeParse({
    lifecycle: sub.status,
    settlement: settlement(sub, latest, paid),
  });
  return evidence.success
    ? {
        kind: 'observed',
        evidence: evidence.data,
        cancelAtPeriodEnd: sub.cancel_at_period_end,
        cancelAt: sub.cancel_at === null ? null : iso(sub.cancel_at),
        amountMinor: unit,
        seatCount: item.quantity,
      }
    : refuse;
}
