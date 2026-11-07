import { z } from 'zod';
import { subscriptionAccess } from '@daisy/auth/authorization';
import type {
  SubscriptionEvidence,
  UsageSource,
} from '@daisy/protocol/billing';

export type BillingSettingsSource = {
  readonly now: string;
  readonly evidence: SubscriptionEvidence | null;
  readonly hasCustomer: boolean;
  readonly purchaseAllowed: boolean;
  readonly botDebates:
    | { readonly kind: 'unavailable' }
    | {
        readonly kind: 'limited';
        readonly remaining: number;
        readonly limit: number;
        readonly source: UsageSource;
        readonly available: boolean;
      };
};
export const billingSettingsSchema = z.strictObject({
  plan: z.enum(['free', 'premium', 'payment-due']),
  accessEndsAt: z.iso.datetime().nullable(),
  checkoutAvailable: z.boolean(),
  manageAvailable: z.boolean(),
  botDebates: z.discriminatedUnion('kind', [
    z.strictObject({ kind: z.literal('unavailable') }),
    z.strictObject({
      kind: z.literal('limited'),
      remaining: z.number().int().nonnegative(),
      limit: z.number().int().positive(),
      scope: z.enum(['lifetime', 'beta-month', 'billing-period']),
      endsAt: z.iso.datetime().nullable(),
      available: z.boolean(),
    }),
  ]),
});
export type BillingSettings = z.infer<typeof billingSettingsSchema>;

/** Display only: return-page claims and cached release flags never enter subscription authority. */
export function billingSettingsView(input: {
  readonly source: BillingSettingsSource;
  readonly configured: boolean;
  readonly purchaseVisible: boolean;
}): BillingSettings {
  const { source } = input;
  const access = source.evidence
    ? subscriptionAccess(source.evidence, source.now)
    : ({ kind: 'none' } as const);
  const bot = source.botDebates;
  return billingSettingsSchema.parse({
    plan:
      access.kind === 'paid'
        ? 'premium'
        : access.kind === 'grace'
          ? 'payment-due'
          : 'free',
    accessEndsAt:
      access.kind === 'none'
        ? null
        : access.kind === 'grace'
          ? access.expiresAt
          : access.period.endsAt,
    checkoutAvailable:
      input.configured && input.purchaseVisible && source.purchaseAllowed,
    manageAvailable: input.configured && source.hasCustomer,
    botDebates:
      bot.kind === 'unavailable'
        ? bot
        : {
            kind: 'limited',
            remaining: bot.remaining,
            limit: bot.limit,
            available: bot.available,
            scope:
              bot.source.kind === 'lifetime'
                ? 'lifetime'
                : bot.source.kind === 'beta'
                  ? 'beta-month'
                  : 'billing-period',
            endsAt: bot.source.kind === 'lifetime' ? null : bot.source.endsAt,
          },
  });
}
