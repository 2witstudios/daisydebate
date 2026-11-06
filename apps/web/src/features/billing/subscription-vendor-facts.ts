import { z } from 'zod';
import { idSchema } from '@daisy/protocol';
import { subscriptionLifecycles } from '@daisy/protocol/billing';
import { premiumPriceSchema } from './premium-price';

const vendorId = (prefix: string) =>
  z
    .string()
    .regex(new RegExp(`^${prefix}_[A-Za-z0-9_]+$`))
    .max(255);
const reference = (prefix: string) =>
  z.union([
    vendorId(prefix),
    z.object({ id: vendorId(prefix) }).transform((value) => value.id),
  ]);
const seconds = z.number().int().nonnegative().max(8_640_000_000_000);
const period = z
  .object({ start: seconds, end: seconds })
  .refine((value) => value.start < value.end);
export const identitySchema = z.strictObject({
  subscriptionId: idSchema,
  vendorSubscriptionId: vendorId('sub'),
  customerId: vendorId('cus'),
  priceId: vendorId('price'),
  mode: z.enum(['test', 'live']),
});
export type BillingSubscriptionIdentity = z.infer<typeof identitySchema>;
export const subscriptionOwnerSchema = identitySchema.omit({
  subscriptionId: true,
});
export type SubscriptionOwner = z.infer<typeof subscriptionOwnerSchema>;
export const subscriptionSchema = z.object({
  id: vendorId('sub'),
  object: z.literal('subscription'),
  customer: reference('cus'),
  livemode: z.boolean(),
  status: z.enum(subscriptionLifecycles),
  collection_method: z.literal('charge_automatically'),
  latest_invoice: reference('in').nullable(),
  cancel_at_period_end: z.boolean(),
  cancel_at: seconds.nullable(),
  items: z.object({
    has_more: z.literal(false),
    data: z
      .array(
        z
          .object({
            id: vendorId('si'),
            quantity: z.literal(1),
            current_period_start: seconds,
            current_period_end: seconds,
            price: premiumPriceSchema,
          })
          .refine(
            (value) => value.current_period_start < value.current_period_end,
          ),
      )
      .length(1),
  }),
});
export const invoiceSchema = z.object({
  id: vendorId('in'),
  object: z.literal('invoice'),
  customer: reference('cus'),
  livemode: z.boolean(),
  currency: z.literal('usd'),
  collection_method: z.literal('charge_automatically'),
  billing_reason: z.enum([
    'subscription_create',
    'subscription_cycle',
    'subscription_update',
    'subscription_threshold',
    'manual',
  ]),
  status: z.enum(['draft', 'open', 'paid', 'uncollectible', 'void']).nullable(),
  amount_remaining: z.number().int().nonnegative(),
  attempted: z.boolean(),
  attempt_count: z.number().int().nonnegative(),
  status_transitions: z.object({ paid_at: seconds.nullable() }),
  parent: z.object({
    type: z.literal('subscription_details'),
    subscription_details: z.object({ subscription: reference('sub') }),
  }),
  lines: z.object({
    has_more: z.literal(false),
    data: z
      .array(
        z.object({
          id: vendorId('il'),
          currency: z.literal('usd'),
          amount: z.number().int().nonnegative(),
          quantity: z.literal(1),
          livemode: z.boolean(),
          period,
          parent: z.object({
            type: z.literal('subscription_item_details'),
            subscription_item_details: z.object({
              subscription: reference('sub'),
              subscription_item: vendorId('si'),
              proration: z.literal(false),
            }),
          }),
          pricing: z.object({
            type: z.literal('price_details'),
            price_details: z.object({ price: reference('price') }),
          }),
        }),
      )
      .length(1),
  }),
});
