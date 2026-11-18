import { z } from 'zod';
import { secret } from './secrets';

/** Vendor configuration never releases Checkout or grants a subscription. */
export type BillingConfig =
  | { readonly kind: 'disabled' }
  | {
      readonly kind: 'stripe';
      readonly mode: 'test' | 'live';
      readonly secretKey: string;
      readonly webhookSecret: string;
      readonly premiumPriceId: string;
      readonly portalConfigurationId: string;
      /** Club seats (ADR 0148): off until both of its ids are configured. */
      readonly club: ClubBillingConfig | null;
      /**
       * The one-time host event prices (ADR 0149); null where they are not
       * configured, which leaves event upgrades unavailable and Premium as is.
       */
      readonly hostEventPrices: {
        readonly event_64: string;
        readonly event_unlimited: string;
      } | null;
    };
export type ClubBillingConfig = {
  /** USD 10 per seat a month, lookup key daisy_club_seat_monthly_usd_10. */
  readonly seatPriceId: string;
  /** A portal for payment method, invoices and cancel; never quantity. */
  readonly portalConfigurationId: string;
};

export const billingFields = {
  STRIPE_SECRET_KEY: secret(
    z.string().regex(/^(sk|rk)_(test|live)_[A-Za-z0-9_]+$/),
  ).optional(),
  STRIPE_WEBHOOK_SECRET: secret(
    z.string().regex(/^whsec_[A-Za-z0-9_]+$/),
  ).optional(),
  STRIPE_PREMIUM_PRICE_ID: z
    .string()
    .regex(/^price_[A-Za-z0-9]+$/)
    .optional(),
  STRIPE_PORTAL_CONFIGURATION_ID: z
    .string()
    .regex(/^bpc_[A-Za-z0-9]+$/)
    .optional(),
};

/** Optional within a configured Stripe group: Club may stay off while Premium is on. */
export const clubBillingFields = {
  STRIPE_CLUB_SEAT_PRICE_ID: z
    .string()
    .regex(/^price_[A-Za-z0-9]+$/)
    .optional(),
  STRIPE_CLUB_PORTAL_CONFIGURATION_ID: z
    .string()
    .regex(/^bpc_[A-Za-z0-9]+$/)
    .optional(),
};

/** Host event prices are their own optional group too (ADR 0149). */
export const hostEventPriceFields = {
  STRIPE_HOST_EVENT_64_PRICE_ID: z
    .string()
    .regex(/^price_[A-Za-z0-9]+$/)
    .optional(),
  STRIPE_HOST_EVENT_UNLIMITED_PRICE_ID: z
    .string()
    .regex(/^price_[A-Za-z0-9]+$/)
    .optional(),
};

type BillingFields = z.output<z.ZodObject<typeof billingFields>> &
  z.output<z.ZodObject<typeof clubBillingFields>> &
  z.output<z.ZodObject<typeof hostEventPriceFields>>;

/** An incomplete group cannot silently disable management of existing billing. */
export function refineBillingConfig(
  config: BillingFields,
  ctx: z.RefinementCtx,
) {
  const fields = Object.keys(billingFields) as (keyof BillingFields)[];
  const club = Object.keys(clubBillingFields) as (keyof BillingFields)[];
  const absent = fields.every((field) => config[field] === undefined);
  if (!absent)
    for (const field of fields) {
      if (config[field] === undefined)
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: 'Required for billing',
        });
    }
  // Each optional group is all or nothing, and needs the billing group.
  const optional = (group: readonly (keyof BillingFields)[], name: string) => {
    if (group.every((field) => config[field] === undefined)) return;
    for (const field of group)
      if (absent || config[field] === undefined)
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: absent
            ? `${name} billing needs the Stripe billing group`
            : `Required for ${name} billing`,
        });
  };
  optional(club, 'Club');
  optional(
    Object.keys(hostEventPriceFields) as (keyof BillingFields)[],
    'Host event',
  );
}

export function withBillingConfig<Config extends BillingFields>({
  STRIPE_SECRET_KEY: secretKey,
  STRIPE_WEBHOOK_SECRET: webhookSecret,
  STRIPE_PREMIUM_PRICE_ID: premiumPriceId,
  STRIPE_PORTAL_CONFIGURATION_ID: portalConfigurationId,
  STRIPE_CLUB_SEAT_PRICE_ID: seatPriceId,
  STRIPE_CLUB_PORTAL_CONFIGURATION_ID: clubPortalConfigurationId,
  STRIPE_HOST_EVENT_64_PRICE_ID: hostEvent64,
  STRIPE_HOST_EVENT_UNLIMITED_PRICE_ID: hostEventUnlimited,
  ...config
}: Config) {
  const billing: BillingConfig =
    secretKey !== undefined &&
    webhookSecret !== undefined &&
    premiumPriceId !== undefined &&
    portalConfigurationId !== undefined
      ? {
          kind: 'stripe',
          mode:
            secretKey.startsWith('sk_test_') || secretKey.startsWith('rk_test_')
              ? 'test'
              : 'live',
          secretKey,
          webhookSecret,
          premiumPriceId,
          portalConfigurationId,
          club:
            seatPriceId !== undefined && clubPortalConfigurationId !== undefined
              ? {
                  seatPriceId,
                  portalConfigurationId: clubPortalConfigurationId,
                }
              : null,
          hostEventPrices:
            hostEvent64 !== undefined && hostEventUnlimited !== undefined
              ? { event_64: hostEvent64, event_unlimited: hostEventUnlimited }
              : null,
        }
      : { kind: 'disabled' };
  return { ...config, billing };
}
