import { z } from 'zod';
import { monthlyPriceShape } from './premium-price';

/**
 * The Club plan (ADR 0148): USD 10 per seat a month, one Stripe subscription
 * whose quantity is the seat count, its price found by this lookup key.
 */
export const clubSeatOffer = {
  unitAmount: 1000,
  lookupKey: 'daisy_club_seat_monthly_usd_10',
} as const;

/** Checkout, subscription and invoice reads verify exactly this price. */
export const clubSeatPriceSchema = z.object({
  ...monthlyPriceShape,
  unit_amount: z.literal(clubSeatOffer.unitAmount),
  lookup_key: z.literal(clubSeatOffer.lookupKey),
});
