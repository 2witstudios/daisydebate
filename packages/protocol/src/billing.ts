export {
  classifyPaymentObservation,
  retainRefundAdmissionConflict,
} from './billing-payment-observation-policy';
export { unknownPaymentFacts } from './billing-payment-observation-facts';
export {
  ownedPaymentObservationSchema,
  applyPaymentObservationRead,
} from './billing-payment-observation-read';
export type { OwnedPaymentObservation } from './billing-payment-observation-read';
export { advanceUsage } from './usage-lifecycle';
export {
  billingPaymentObservationSchema,
  billingPaymentObservationStateSchema,
  paymentObservationSourceSchema,
} from './billing-payment-observation';
export { ownedInvoiceObservationSchema } from './billing-payment-observation-source';
export type { OwnedInvoiceObservation } from './billing-payment-observation-source';
export { retainPaymentObservationSource } from './billing-payment-observation-retention';
export type {
  BillingPaymentObservation,
  PaymentObservationContext,
} from './billing-payment-observation';
export { advanceCleanup, ownsCleanupClaim } from './billing-cleanup-lifecycle';
export {
  billingCleanupSchema,
  cleanupWorkSchema,
  cleanupBounds,
  cleanupWork,
  startCleanup,
} from './billing-cleanup';
export type {
  CleanupContext,
  CleanupEvent,
  CleanupState,
  CleanupWork,
} from './billing-cleanup';
export { advanceRefund, nextRefundWork } from './billing-refund-lifecycle';
export {
  closurePaymentDisposition,
  mayDispatchRefund,
  refundActionSchema,
  refundBounds,
  refundClaimSchema,
  refundIdempotencyKey,
  refundStateSchema,
  refundStatuses,
} from './billing-refund';
export type {
  RefundAction,
  RefundContext,
  RefundEvent,
  RefundState,
  RefundStatus,
} from './billing-refund';
export {
  advancePurchase,
  nextPurchaseWork,
} from './billing-purchase-lifecycle';
export {
  purchaseBounds,
  purchaseIdempotencyKey,
  purchaseSchema,
  purchaseSessionExpiry,
  purchaseStateSchema,
} from './billing-purchase';
export type {
  Purchase,
  PurchaseContext,
  PurchaseEvent,
  PurchaseObservation,
  PurchaseState,
} from './billing-purchase';
export { reconcileSubscriptionEvidence } from './billing-reconciliation';
export {
  advanceBillingSync,
  billingSyncBounds,
  billingSyncStateSchema,
} from './billing-sync';
export type { BillingSyncState } from './billing-sync';
import type { EntitlementGrant } from './entitlements';
import { z } from 'zod';
import { idSchema } from './primitives';

/** Verified invoice-line period, not the time a webhook happened to arrive. */
export type SubscriptionPeriod = {
  /** Local billing subscription identity; vendor identifiers stay in the billing mapping. */
  readonly subscriptionId: string;
  readonly startsAt: string;
  readonly endsAt: string;
};

type PaidPeriod = {
  readonly invoiceId: string;
  readonly period: SubscriptionPeriod;
};

export const subscriptionLifecycles = [
  'active',
  'past_due',
  'canceled',
  'unpaid',
  'paused',
  'incomplete',
  'incomplete_expired',
  'trialing',
] as const;

/** Produced only after the vendor adapter verifies the configured plan and payment. */
export type SubscriptionEvidence = {
  readonly lifecycle: (typeof subscriptionLifecycles)[number];
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
export const usageKindSchema = z.enum(usageKinds);
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
      /** Null previews a new Round; durable admission always requires its actual identity. */
      readonly roundId: string | null;
      readonly withJudge: boolean;
    }
  | {
      readonly kind: 'casual_judge' | 'round_analysis';
      readonly roundId: string | null;
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

/** Stable request identity shared by policy and persistence recovery. */
export function requestedUsageKinds(
  request: AllowanceRequest,
): readonly UsageKind[] {
  switch (request.kind) {
    case 'bot_debate':
      return request.withJudge ? ['ai_round', 'casual_ai_judge'] : ['ai_round'];
    case 'casual_judge':
      return ['casual_ai_judge'];
    case 'round_analysis':
      return ['round_analysis'];
  }
}

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

/** Observed historical relief does not authorize a new live credit. */
export type UsageCreditProvenance =
  PlatformUsageCredit | { readonly kind: 'recorded_restoration' };

export type UsageProviderOutcome =
  'dispatched' | 'unknown' | 'delivered' | 'definite_failure';

/** States that still consume their original allowance; restoration never moves periods. */
export const usageHoldingStates = [
  'reserved',
  'dispatched',
  'unknown',
  'delivered',
  'definite_failure',
] as const;

export type UsageCountBasis = 'dispatch_record' | 'historical_observation';
/** A historical recognition instant never asserts the vendor's exact dispatch time. */
type UsageCount = {
  readonly countedAt: string;
  readonly countBasis: UsageCountBasis;
};

/** Provider jobs retain their independent outcomes; this is only allowance accounting. */
export type UsageState =
  | { readonly kind: 'reserved' }
  | (UsageCount & { readonly kind: 'dispatched' | 'unknown' | 'delivered' })
  | (UsageCount & {
      /** Proven nonservice without a recorded allowance restoration. */
      readonly kind: 'definite_failure';
    })
  | (UsageCount & { readonly kind: 'refunded'; readonly refundedAt: string })
  | (UsageCount & {
      readonly kind: 'credited';
      readonly creditedAt: string;
      readonly provenance: UsageCreditProvenance;
      /** An allowance credit never rewrites provider evidence. */
      readonly providerOutcome: UsageProviderOutcome;
    })
  | { readonly kind: 'released'; readonly releasedAt: string };

export type FreeBindingReleaseFacts = {
  readonly boundRoundId: string | null;
  readonly roundId: string;
  readonly abandoned: boolean;
  readonly bot: UsageState | null;
  readonly judge:
    | { readonly kind: 'unselected' | 'missing' }
    | { readonly kind: 'selected'; readonly state: UsageState };
};

export type UsageEvent =
  | { readonly kind: 'dispatch' | 'expire'; readonly before: string }
  | { readonly kind: 'abandon' }
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
};
export type UsageContext = {
  readonly now: string;
  readonly authorized: boolean;
};

const interval = {
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
};
const orderedInterval = (value: { startsAt: string; endsAt: string }) =>
  Date.parse(value.startsAt) < Date.parse(value.endsAt);
const subscriptionPeriodSchema = z
  .strictObject({
    subscriptionId: idSchema,
    ...interval,
  })
  .refine(orderedInterval, 'Period must have positive duration');

/** Validated at every durable write/read; attribution never uses a mutable current month. */
export const usageSourceSchema: z.ZodType<UsageSource> = z.discriminatedUnion(
  'kind',
  [
    z.strictObject({ kind: z.literal('lifetime') }),
    z
      .strictObject({ kind: z.literal('beta'), ...interval })
      .refine(orderedInterval, 'Period must have positive duration'),
    z
      .strictObject({
        kind: z.literal('subscription'),
        ...subscriptionPeriodSchema.shape,
      })
      .refine(orderedInterval, 'Period must have positive duration'),
  ],
);
const paidPeriodSchema = z.strictObject({
  invoiceId: z
    .string()
    .regex(/^in_[A-Za-z0-9_]+$/)
    .max(255),
  period: subscriptionPeriodSchema,
});
export const subscriptionEvidenceSchema: z.ZodType<SubscriptionEvidence> =
  z.strictObject({
    lifecycle: z.enum(subscriptionLifecycles),
    settlement: z.discriminatedUnion('kind', [
      z.strictObject({ kind: z.literal('unpaid') }),
      z.strictObject({ kind: z.literal('paid'), ...paidPeriodSchema.shape }),
      z.strictObject({
        kind: z.literal('renewal_failed'),
        ...paidPeriodSchema.shape,
        previous: paidPeriodSchema,
      }),
    ]),
  });
const platformCreditSchema: z.ZodType<PlatformUsageCredit> =
  z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('recovery_bound'), incidentId: idSchema }),
    z.strictObject({
      kind: z.literal('capture_shortfall'),
      commandId: idSchema,
      freezeRevision: z.number().int().positive(),
    }),
  ]);
const counted = {
  countedAt: z.iso.datetime(),
  countBasis: z.enum(['dispatch_record', 'historical_observation']),
};
export const usageStateSchema: z.ZodType<UsageState> = z.discriminatedUnion(
  'kind',
  [
    z.strictObject({ kind: z.literal('reserved') }),
    z.strictObject({
      kind: z.enum(['dispatched', 'unknown', 'delivered', 'definite_failure']),
      ...counted,
    }),
    z
      .strictObject({
        kind: z.literal('refunded'),
        ...counted,
        refundedAt: z.iso.datetime(),
      })
      .refine(
        (state) => Date.parse(state.countedAt) <= Date.parse(state.refundedAt),
        'Refund cannot precede counting',
      ),
    z
      .strictObject({
        kind: z.literal('credited'),
        ...counted,
        creditedAt: z.iso.datetime(),
        provenance: z.union([
          platformCreditSchema,
          z.strictObject({ kind: z.literal('recorded_restoration') }),
        ]),
        providerOutcome: z.enum([
          'dispatched',
          'unknown',
          'delivered',
          'definite_failure',
        ]),
      })
      .refine(
        (state) => Date.parse(state.countedAt) <= Date.parse(state.creditedAt),
        'Credit cannot precede counting',
      ),
    z.strictObject({
      kind: z.literal('released'),
      releasedAt: z.iso.datetime(),
    }),
  ],
);
