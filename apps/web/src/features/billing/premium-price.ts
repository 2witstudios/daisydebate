import { z } from 'zod';

/** Both Checkout and recurring invoice reconciliation verify the same fixed offer. */
export const premiumPriceSchema = z.object({
  id: z
    .string()
    .regex(/^price_[A-Za-z0-9_]+$/)
    .max(255),
  currency: z.literal('usd'),
  unit_amount: z.literal(1000),
  livemode: z.boolean(),
  recurring: z.object({
    interval: z.literal('month'),
    interval_count: z.literal(1),
    usage_type: z.literal('licensed'),
  }),
});
