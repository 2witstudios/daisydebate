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
      /**
       * The one-time host event prices (ADR 0147); null where they are not
       * configured, which leaves event upgrades unavailable and Premium as is.
       */
      readonly hostEventPrices: {
        readonly event_64: string;
        readonly event_unlimited: string;
      } | null;
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

const priceId = z
  .string()
  .regex(/^price_[A-Za-z0-9]+$/)
  .optional();
/** Host event prices are their own group: an environment may sell Premium without them. */
export const hostEventPriceFields = {
  STRIPE_HOST_EVENT_64_PRICE_ID: priceId,
  STRIPE_HOST_EVENT_UNLIMITED_PRICE_ID: priceId,
};

type BillingFields = z.output<z.ZodObject<typeof billingFields>> &
  z.output<z.ZodObject<typeof hostEventPriceFields>>;

/** An incomplete group cannot silently disable management of existing billing. */
export function refineBillingConfig(
  config: BillingFields,
  ctx: z.RefinementCtx,
) {
  const complete = (fields: readonly (keyof BillingFields)[]) => {
    if (fields.every((field) => config[field] === undefined)) return false;
    for (const field of fields) {
      if (config[field] === undefined)
        ctx.addIssue({
          code: 'custom',
          path: [field],
          message: 'Required for billing',
        });
    }
    return true;
  };
  const billing = complete(
    Object.keys(billingFields) as (keyof BillingFields)[],
  );
  const hostEvent = complete(
    Object.keys(hostEventPriceFields) as (keyof BillingFields)[],
  );
  if (hostEvent && !billing)
    ctx.addIssue({
      code: 'custom',
      path: ['STRIPE_HOST_EVENT_64_PRICE_ID'],
      message: 'Host event prices need the billing group',
    });
}

export function withBillingConfig<Config extends BillingFields>({
  STRIPE_SECRET_KEY: secretKey,
  STRIPE_WEBHOOK_SECRET: webhookSecret,
  STRIPE_PREMIUM_PRICE_ID: premiumPriceId,
  STRIPE_PORTAL_CONFIGURATION_ID: portalConfigurationId,
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
          hostEventPrices:
            hostEvent64 !== undefined && hostEventUnlimited !== undefined
              ? { event_64: hostEvent64, event_unlimited: hostEventUnlimited }
              : null,
        }
      : { kind: 'disabled' };
  return { ...config, billing };
}
