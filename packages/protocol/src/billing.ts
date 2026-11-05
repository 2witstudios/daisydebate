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
  /** Durable verified evidence, never an observation-time access snapshot. */
  readonly billing: SubscriptionEvidence | null;
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

/** Only the existing trusted Round termination paths may supply this provenance. */
export type PlatformUsageCredit =
  | { readonly kind: 'recovery_bound'; readonly incidentId: string }
  | {
      readonly kind: 'capture_shortfall';
      readonly commandId: string;
      readonly freezeRevision: number;
    };

export type UsageProviderOutcome =
  'dispatched' | 'unknown' | 'delivered' | 'definite_failure';

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
  | {
      readonly kind: 'credited';
      readonly countedAt: string;
      readonly creditedAt: string;
      readonly provenance: PlatformUsageCredit;
      /** A platform allowance credit never rewrites provider evidence. */
      readonly providerOutcome: UsageProviderOutcome;
    }
  | { readonly kind: 'released'; readonly releasedAt: string };

export type UsageEvent =
  | { readonly kind: 'dispatch' | 'expire' | 'abandon' }
  | {
      readonly kind: 'platform_credit';
      readonly provenance: PlatformUsageCredit;
    }
  | {
      readonly kind: 'settle';
      /** Aggregate of every call: no pending/unknown call permits definite_failure. */
      readonly outcome: Exclude<UsageProviderOutcome, 'dispatched'>;
    };
export type UsageTransition =
  | { readonly kind: 'changed' | 'unchanged'; readonly state: UsageState }
  | { readonly kind: 'refuse' };
export type UsageReservation = {
  readonly kind: UsageKind;
  readonly state: UsageState;
  readonly admittedAt: string;
  /** The feature's current dispatch bound, independent of payment period expiry. */
  readonly dispatchBefore: string;
};
export type UsageContext = {
  readonly now: string;
  readonly authorized: boolean;
};
