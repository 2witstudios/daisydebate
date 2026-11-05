import type { EntitlementGrant } from './entitlements';

/** Verified invoice-line period, not the time a webhook happened to arrive. */
export type SubscriptionPeriod = {
  readonly subscriptionId: string;
  readonly startsAt: string;
  readonly endsAt: string;
};

type PaidPeriod = {
  readonly invoiceId: string;
  readonly period: SubscriptionPeriod;
};

/** Produced only after the vendor adapter verifies the configured plan and payment. */
export type SubscriptionEvidence = {
  readonly lifecycle:
    | 'active'
    | 'past_due'
    | 'canceled'
    | 'unpaid'
    | 'paused'
    | 'incomplete'
    | 'incomplete_expired'
    | 'trialing';
  readonly settlement:
    | { readonly kind: 'unpaid' }
    | ({ readonly kind: 'paid' } & PaidPeriod)
    | ({
        readonly kind: 'renewal_failed';
        readonly previous: PaidPeriod;
      } & PaidPeriod);
};

/** Semantic access; consumers must still evaluate its interval at their current instant. */
export type BillingAccess =
  | { readonly kind: 'none' }
  | { readonly kind: 'paid'; readonly period: SubscriptionPeriod }
  | {
      readonly kind: 'grace';
      readonly period: SubscriptionPeriod;
      readonly expiresAt: string;
    };

export const usageKinds = [
  'ai_round',
  'casual_ai_judge',
  'round_analysis',
] as const;
export type UsageKind = (typeof usageKinds)[number];
/** Immutable attribution; account/actor identity belongs to the owning ledger row. */
export type UsageSource =
  | { readonly kind: 'lifetime' }
  | {
      readonly kind: 'beta';
      readonly startsAt: string;
      readonly endsAt: string;
    }
  | ({ readonly kind: 'subscription' } & SubscriptionPeriod);

export type AllowanceRequest =
  | {
      readonly kind: 'bot_debate';
      readonly roundId: string;
      readonly withJudge: boolean;
    }
  | {
      readonly kind: 'casual_judge' | 'round_analysis';
      readonly roundId: string;
    };

export type AllowanceFacts = {
  readonly billing: BillingAccess;
  readonly grants: readonly EntitlementGrant[];
  /** Reserved, dispatched, unknown and delivered use count; proven releases/refunds do not. */
  readonly usage: readonly {
    readonly kind: UsageKind;
    readonly source: UsageSource;
    readonly spent: number;
  }[];
  readonly freeBotRoundId: string | null;
};

export type AllowanceDecision =
  | {
      readonly kind: 'refuse';
      readonly reason:
        | 'not-eligible'
        | 'invalid-facts'
        | 'allowance'
        | 'renewal-grace'
        | 'free-judge-unbound';
    }
  | {
      readonly kind: 'admit';
      readonly reservations: readonly {
        readonly kind: UsageKind;
        readonly source: UsageSource;
        readonly limit: number | null;
      }[];
    };

/** Provider jobs retain their independent outcomes; this is only allowance accounting. */
export type UsageState =
  | { readonly kind: 'reserved' }
  | {
      readonly kind: 'dispatched' | 'unknown' | 'delivered';
      readonly countedAt: string;
    }
  | {
      readonly kind: 'refunded';
      readonly countedAt: string;
      readonly refundedAt: string;
    }
  | { readonly kind: 'released'; readonly releasedAt: string };
