import type { EntitlementGrant } from '@daisy/protocol';
import type {
  BillingAccess,
  SubscriptionEvidence,
  SubscriptionPeriod,
} from '@daisy/protocol/billing';

const graceMs = 7 * 24 * 60 * 60 * 1000;
const none = { kind: 'none' } as const;
const validPeriod = (period: SubscriptionPeriod) =>
  period.subscriptionId.length > 0 &&
  Number.isFinite(Date.parse(period.startsAt)) &&
  Number.isFinite(Date.parse(period.endsAt)) &&
  Date.parse(period.startsAt) < Date.parse(period.endsAt);

function paidAccess(period: SubscriptionPeriod, now: number): BillingAccess {
  return validPeriod(period) &&
    Date.parse(period.startsAt) <= now &&
    now < Date.parse(period.endsAt)
    ? { kind: 'paid', period }
    : none;
}

type VerifiedAccessPeriod =
  | { readonly kind: 'paid'; readonly period: SubscriptionPeriod }
  | {
      readonly kind: 'renewal_failed';
      readonly period: SubscriptionPeriod;
      readonly graceEndsAt: string;
    };

function renewalPeriod(
  settlement: Extract<
    SubscriptionEvidence['settlement'],
    { kind: 'renewal_failed' }
  >,
): VerifiedAccessPeriod | null {
  const previous = settlement.previous.period;
  const renewal = settlement.period;
  if (
    !validPeriod(previous) ||
    !validPeriod(renewal) ||
    previous.subscriptionId !== renewal.subscriptionId ||
    Date.parse(previous.endsAt) !== Date.parse(renewal.startsAt)
  )
    return null;
  const end = new Date(Date.parse(previous.endsAt) + graceMs);
  return Number.isFinite(end.getTime())
    ? {
        kind: 'renewal_failed',
        period: previous,
        graceEndsAt: end.toISOString(),
      }
    : null;
}
function verifiedAccessPeriod(
  evidence: SubscriptionEvidence,
): VerifiedAccessPeriod | null {
  if (!['active', 'past_due'].includes(evidence.lifecycle)) return null;
  const settlement = evidence.settlement;
  switch (settlement.kind) {
    case 'unpaid':
      return null;
    case 'paid':
      return validPeriod(settlement.period)
        ? { kind: 'paid', period: settlement.period }
        : null;
    case 'renewal_failed':
      return renewalPeriod(settlement);
  }
}

/** DEC-364: fixed renewal grace, no initial-payment or unsupported trial access. */
export function subscriptionAccess(
  evidence: SubscriptionEvidence,
  instant: string,
): BillingAccess {
  const now = Date.parse(instant);
  const verified = verifiedAccessPeriod(evidence);
  if (!Number.isFinite(now) || !verified) return none;
  const paid = paidAccess(verified.period, now);
  if (paid.kind === 'paid') return paid;
  return verified.kind === 'renewal_failed' &&
    Date.parse(verified.period.endsAt) <= now &&
    now < Date.parse(verified.graceEndsAt)
    ? {
        kind: 'grace',
        period: verified.period,
        expiresAt: verified.graceEndsAt,
      }
    : none;
}

/** A new capability cannot silently become part of this price. */
const premiumCapabilities = {
  round_analysis: 'paid-and-grace',
  ai_rounds: 'paid-only',
  casual_ai_judge: 'paid-and-grace',
  casual_capture: 'paid-and-grace',
  recording_download: 'paid-and-grace',
} as const satisfies Record<
  EntitlementGrant['entitlement'],
  'paid-and-grace' | 'paid-only'
>;

/** Project known deadlines once; capability reads enforce them even without another observation. */
export function subscriptionGrants(
  evidence: SubscriptionEvidence,
): readonly EntitlementGrant[] {
  const verified = verifiedAccessPeriod(evidence);
  if (!verified) return [];
  const keys = Object.keys(
    premiumCapabilities,
  ) as (keyof typeof premiumCapabilities)[];
  return keys.map((entitlement) => ({
    entitlement,
    source: 'subscription',
    startsAt: verified.period.startsAt,
    expiresAt:
      verified.kind === 'renewal_failed' &&
      premiumCapabilities[entitlement] === 'paid-and-grace'
        ? verified.graceEndsAt
        : verified.period.endsAt,
  }));
}
