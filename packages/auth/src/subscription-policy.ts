import { tryInstantMs, instantMs } from '@daisy/clock';
import type {
  EntitlementGrant,
  PremiumEntitlementKind,
} from '@daisy/protocol/entitlements';
import type {
  BillingAccess,
  SubscriptionEvidence,
  SubscriptionPeriod,
} from '@daisy/protocol/billing';

const graceMs = 7 * 24 * 60 * 60 * 1000;
const none = { kind: 'none' } as const;
const validPeriod = (period: SubscriptionPeriod) =>
  period.subscriptionId.length > 0 &&
  tryInstantMs(period.startsAt) !== undefined &&
  tryInstantMs(period.endsAt) !== undefined &&
  instantMs(period.startsAt) < instantMs(period.endsAt);

function paidAccess(period: SubscriptionPeriod, now: number): BillingAccess {
  return validPeriod(period) &&
    instantMs(period.startsAt) <= now &&
    now < instantMs(period.endsAt)
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
    instantMs(previous.endsAt) !== instantMs(renewal.startsAt)
  )
    return null;
  const end = new Date(instantMs(previous.endsAt) + graceMs);
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
      return evidence.lifecycle === 'past_due'
        ? renewalPeriod(settlement)
        : validPeriod(settlement.previous.period)
          ? { kind: 'paid', period: settlement.previous.period }
          : null;
  }
}

/** DEC-364: fixed renewal grace, no initial-payment or unsupported trial access. */
export function subscriptionAccess(
  evidence: SubscriptionEvidence,
  instant: string,
): BillingAccess {
  const now = tryInstantMs(instant);
  const verified = verifiedAccessPeriod(evidence);
  if (now === undefined || !verified) return none;
  const paid = paidAccess(verified.period, now);
  if (paid.kind === 'paid') return paid;
  return verified.kind === 'renewal_failed' &&
    instantMs(verified.period.endsAt) <= now &&
    now < instantMs(verified.graceEndsAt)
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
  PremiumEntitlementKind,
  'paid-and-grace' | 'paid-only'
>;

/** One Premium entitlement's verified window under a plan's evidence. */
export type PremiumGrantWindow = {
  readonly entitlement: PremiumEntitlementKind;
  readonly startsAt: string;
  readonly expiresAt: string;
};

/**
 * The Premium windows a plan's verified evidence funds: the paid period, and
 * through DEC-364's renewal grace for everything but bot Rounds. Shared by
 * personal Premium and Club seats (ADR 0148), which differ only in source.
 */
export function premiumGrantWindows(
  evidence: SubscriptionEvidence,
): readonly PremiumGrantWindow[] {
  const verified = verifiedAccessPeriod(evidence);
  if (!verified) return [];
  const keys = Object.keys(
    premiumCapabilities,
  ) as (keyof typeof premiumCapabilities)[];
  return keys.map((entitlement) => ({
    entitlement,
    startsAt: verified.period.startsAt,
    expiresAt:
      verified.kind === 'renewal_failed' &&
      premiumCapabilities[entitlement] === 'paid-and-grace'
        ? verified.graceEndsAt
        : verified.period.endsAt,
  }));
}

/** Project known deadlines once; capability reads enforce them even without another observation. */
export function subscriptionGrants(
  evidence: SubscriptionEvidence,
): readonly EntitlementGrant[] {
  return premiumGrantWindows(evidence).map((window) => ({
    ...window,
    source: 'subscription',
  }));
}
