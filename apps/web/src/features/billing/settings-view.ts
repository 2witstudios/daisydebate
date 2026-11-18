import { z } from 'zod';
import { subscriptionAccess } from '@daisy/auth/authorization';
import type { SubscriptionEvidence } from '@daisy/protocol/billing';

export type BillingSettingsSource = {
  readonly now: string;
  readonly evidence: SubscriptionEvidence | null;
  readonly hasCustomer: boolean;
  readonly purchaseAllowed: boolean;
  /** Premium from a current beta grant, with no subscription (ADR 0146). */
  readonly granted: boolean;
  /** From the same verified subscription observation; display only. */
  readonly renewalOff: boolean;
  readonly amountMinor: number | null;
  /** The club whose current seat gives this person Premium (ADR 0148), if any. */
  readonly seat: { readonly name: string; readonly manager: string } | null;
};

/**
 * What the billing page shows. There are no usage counters (PYL-10): only
 * the plan, its price, and when it renews or ends. `granted` is Premium from
 * beta access with nothing to pay. `club-seat` is Premium a club pays for
 * (ADR 0148); a member who also pays for Premium themselves sees their own
 * plan, which stays until they cancel it. Nothing here grants anything.
 */
export const billingSettingsSchema = z.strictObject({
  plan: z.enum([
    'free',
    'granted',
    'premium',
    'cancelled',
    'payment-due',
    'club-seat',
  ]),
  accessEndsAt: z.iso.datetime().nullable(),
  priceMinor: z.number().int().positive().nullable(),
  club: z
    .strictObject({
      name: z.string().min(1).max(120),
      manager: z.string().min(1).max(120),
    })
    .nullable(),
  checkoutAvailable: z.boolean(),
  manageAvailable: z.boolean(),
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
  return billingSettingsSchema.parse({
    plan:
      access.kind === 'paid'
        ? source.renewalOff
          ? 'cancelled'
          : 'premium'
        : access.kind === 'grace'
          ? 'payment-due'
          : source.seat
            ? 'club-seat'
            : source.granted
              ? 'granted'
              : 'free',
    accessEndsAt:
      access.kind === 'none'
        ? null
        : access.kind === 'grace'
          ? access.expiresAt
          : access.period.endsAt,
    priceMinor: access.kind === 'none' ? null : source.amountMinor,
    club: access.kind === 'none' ? source.seat : null,
    checkoutAvailable:
      input.configured &&
      input.purchaseVisible &&
      source.purchaseAllowed &&
      !(access.kind === 'none' && (source.granted || source.seat !== null)),
    manageAvailable: input.configured && source.hasCustomer,
  });
}
