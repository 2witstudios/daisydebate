import { z } from 'zod';
import { maxPurchaseQuantity } from '@daisy/protocol/billing';
import { clubSeatPriceSchema } from './club-price';
import { invoiceSchema, subscriptionSchema } from './subscription-vendor-facts';

/**
 * Stripe facts a Club plan reads (ADR 0148). Premium's own schemas stay
 * exactly one seat and one non-prorated line; a Club subscription carries
 * its seat count as the item quantity, and a seat increase adds a prorated
 * `subscription_update` invoice of several lines.
 */
const seconds = z.number().int().nonnegative().max(8_640_000_000_000);
const seats = z.number().int().min(1).max(maxPurchaseQuantity);

export const clubSubscriptionSchema = subscriptionSchema.extend({
  items: z.object({
    has_more: z.literal(false),
    data: z
      .array(
        z
          .object({
            id: z
              .string()
              .regex(/^si_[A-Za-z0-9_]+$/)
              .max(255),
            quantity: seats,
            current_period_start: seconds,
            current_period_end: seconds,
            price: clubSeatPriceSchema,
          })
          .refine(
            (value) => value.current_period_start < value.current_period_end,
          ),
      )
      .length(1),
  }),
});

const baseLine = invoiceSchema.shape.lines.shape.data.element;
const clubLine = baseLine.extend({
  /** A prorated credit is negative. */
  amount: z.number().int(),
  quantity: z.number().int().min(0).max(maxPurchaseQuantity),
  parent: z.object({
    type: z.literal('subscription_item_details'),
    subscription_item_details: z.object({
      subscription:
        baseLine.shape.parent.shape.subscription_item_details.shape
          .subscription,
      subscription_item: z
        .string()
        .regex(/^si_[A-Za-z0-9_]+$/)
        .max(255),
      proration: z.boolean(),
    }),
  }),
});

export const clubInvoiceSchema = invoiceSchema.extend({
  lines: z.object({
    has_more: z.literal(false),
    data: z.array(clubLine).min(1).max(20),
  }),
});
export type ClubInvoice = z.infer<typeof clubInvoiceSchema>;
export type ClubSubscription = z.infer<typeof clubSubscriptionSchema>;
