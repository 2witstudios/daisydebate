import { z } from 'zod';

/**
 * The Premium offer a new Checkout sells (ADR 0146): USD 20 a month, its
 * Stripe price found by this lookup key. Existing subscriptions keep the
 * price they bought; the grandfathered USD 10 offer is only ever read.
 */
export const premiumOffer = {
  unitAmount: 2000,
  lookupKey: 'daisy_premium_monthly_usd_20',
} as const;
const grandfatheredUnitAmount = 1000;

/** "$20/month" from minor units: a subscriber's own price, or the offer's. */
export const monthlyPrice = (minor: number) => {
  const dollars = minor / 100;
  return `$${Number.isInteger(dollars) ? dollars : dollars.toFixed(2)}/month`;
};
/** The current offer as copy shows it. */
export const premiumOfferPrice = monthlyPrice(premiumOffer.unitAmount);

const priceShape = {
  id: z
    .string()
    .regex(/^price_[A-Za-z0-9_]+$/)
    .max(255),
  currency: z.literal('usd'),
  livemode: z.boolean(),
  recurring: z.object({
    interval: z.literal('month'),
    interval_count: z.literal(1),
    usage_type: z.literal('licensed'),
  }),
};

/** A new Checkout verifies exactly the current offer. */
export const premiumPriceSchema = z.object({
  ...priceShape,
  unit_amount: z.literal(premiumOffer.unitAmount),
  lookup_key: z.literal(premiumOffer.lookupKey),
});

/**
 * Subscription, invoice and closure reads verify the price the subscriber
 * holds: the current offer or the grandfathered one. Each invoice line must
 * still equal its own subscription's amount.
 */
export const subscribedPriceSchema = z.object({
  ...priceShape,
  lookup_key: z.string().max(200).nullable().optional(),
  unit_amount: z.union([
    z.literal(premiumOffer.unitAmount),
    z.literal(grandfatheredUnitAmount),
  ]),
});
export const subscribedAmounts: readonly number[] = [
  premiumOffer.unitAmount,
  grandfatheredUnitAmount,
];
