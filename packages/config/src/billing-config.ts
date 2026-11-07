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

type BillingFields = z.output<z.ZodObject<typeof billingFields>>;

/** An incomplete group cannot silently disable management of existing billing. */
export function refineBillingConfig(
  config: BillingFields,
  ctx: z.RefinementCtx,
) {
  const fields = Object.keys(billingFields) as (keyof BillingFields)[];
  if (fields.every((field) => config[field] === undefined)) return;
  for (const field of fields) {
    if (config[field] === undefined)
      ctx.addIssue({
        code: 'custom',
        path: [field],
        message: 'Required for billing',
      });
  }
}

export function withBillingConfig<Config extends BillingFields>({
  STRIPE_SECRET_KEY: secretKey,
  STRIPE_WEBHOOK_SECRET: webhookSecret,
  STRIPE_PREMIUM_PRICE_ID: premiumPriceId,
  STRIPE_PORTAL_CONFIGURATION_ID: portalConfigurationId,
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
        }
      : { kind: 'disabled' };
  return { ...config, billing };
}
