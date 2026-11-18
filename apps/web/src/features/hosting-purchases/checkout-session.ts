import type Stripe from 'stripe';
import { z } from 'zod';
import {
  hostingOffers,
  type PaidHostingTier,
} from '@daisy/protocol/lobby/hosting-tier';

/** The stored purchase a session is created for and checked against. */
export type HostingCheckoutPurchase = {
  readonly id: string;
  readonly lobbyId: string;
  readonly tier: PaidHostingTier;
  /** USD cents owed: the tier's price, or the difference from the tier held. */
  readonly amount: number;
  readonly mode: 'test' | 'live';
  readonly vendorSessionId: string | null;
};

const priceSchema = z.object({
  id: z
    .string()
    .regex(/^price_[A-Za-z0-9_]+$/)
    .max(255),
  object: z.literal('price'),
  active: z.literal(true),
  currency: z.literal('usd'),
  livemode: z.boolean(),
  type: z.literal('one_time'),
  unit_amount: z.number().int(),
  lookup_key: z.string().nullable(),
  product: z
    .string()
    .regex(/^prod_[A-Za-z0-9_]+$/)
    .max(255),
});

/**
 * The configured price, accepted only when it is the tier's one-time offer
 * in this mode: its amount and lookup key, never the configuration alone.
 */
export function verifiedHostingPrice(
  tier: PaidHostingTier,
  mode: 'test' | 'live',
  raw: unknown,
): { readonly id: string; readonly product: string } | null {
  const parsed = priceSchema.safeParse(raw);
  if (!parsed.success) return null;
  const price = parsed.data;
  const offer = hostingOffers[tier];
  return price.unit_amount === offer.unitAmount &&
    price.lookup_key === offer.lookupKey &&
    price.livemode === (mode === 'live')
    ? { id: price.id, product: price.product }
    : null;
}

/** A full price sells the configured price; the move to unlimited charges the difference. */
export type HostingLine =
  | { readonly kind: 'price'; readonly id: string }
  | { readonly kind: 'difference'; readonly product: string };

const metadataOf = (purchase: HostingCheckoutPurchase) => ({
  daisy_hosting_purchase_id: purchase.id,
  daisy_lobby_id: purchase.lobbyId,
});

export function hostingCheckoutParameters(
  purchase: HostingCheckoutPurchase,
  line: HostingLine,
  returns: { readonly successUrl: string; readonly cancelUrl: string },
) {
  const metadata = metadataOf(purchase);
  return {
    mode: 'payment',
    ui_mode: 'hosted_page',
    line_items: [
      line.kind === 'price'
        ? { price: line.id, quantity: 1 }
        : {
            price_data: {
              currency: 'usd',
              product: line.product,
              unit_amount: purchase.amount,
            },
            quantity: 1,
          },
    ],
    allowed_payment_method_types: ['card'],
    client_reference_id: purchase.id,
    metadata,
    payment_intent_data: { metadata },
    success_url: returns.successUrl,
    cancel_url: returns.cancelUrl,
  } satisfies Stripe.Checkout.SessionCreateParams;
}

// The same patterns as the table's identity check, so a session this
// accepts can always be stored.
const sessionId = z
  .string()
  .regex(/^cs_(test|live)_[A-Za-z0-9]+$/)
  .max(255);
const paymentIntentId = z
  .string()
  .regex(/^pi_[A-Za-z0-9]+$/)
  .max(255);
const sessionSchema = z.object({
  object: z.literal('checkout.session'),
  id: sessionId,
  livemode: z.boolean(),
  mode: z.literal('payment'),
  status: z.enum(['open', 'complete', 'expired']),
  payment_status: z.enum(['paid', 'unpaid', 'no_payment_required']),
  client_reference_id: z.string().nullable(),
  metadata: z.object({
    daisy_hosting_purchase_id: z.string(),
    daisy_lobby_id: z.string(),
  }),
  currency: z.literal('usd'),
  amount_subtotal: z.number().int(),
  url: z.string().max(8192).nullable(),
  payment_intent: z
    .object({
      id: paymentIntentId,
      latest_charge: z
        .object({
          receipt_url: z
            .string()
            .regex(/^https:\/\/pay\.stripe\.com\/receipts\//)
            .max(2048)
            .nullable(),
        })
        .nullable(),
    })
    .nullable(),
});

export type HostingSessionObservation =
  | {
      readonly kind: 'paid';
      readonly vendorPaymentIntentId: string;
      readonly receiptUrl: string | null;
    }
  | { readonly kind: 'open'; readonly url: string | null }
  | { readonly kind: 'expired' }
  | { readonly kind: 'mismatch' };

const mismatch = { kind: 'mismatch' } as const;

/**
 * Reads a session retrieved from Stripe (never a webhook payload) against
 * the purchase it must belong to. Only an exact match can settle anything.
 */
export function observeHostingSession(
  purchase: HostingCheckoutPurchase,
  raw: unknown,
): HostingSessionObservation {
  const parsed = sessionSchema.safeParse(raw);
  if (!parsed.success) return mismatch;
  const session = parsed.data;
  if (
    session.id !== purchase.vendorSessionId ||
    session.livemode !== (purchase.mode === 'live') ||
    session.client_reference_id !== purchase.id ||
    session.metadata.daisy_hosting_purchase_id !== purchase.id ||
    session.metadata.daisy_lobby_id !== purchase.lobbyId ||
    session.amount_subtotal !== purchase.amount
  )
    return mismatch;
  switch (session.status) {
    case 'open':
      return { kind: 'open', url: session.url };
    case 'expired':
      return { kind: 'expired' };
    case 'complete':
      return session.payment_status === 'paid' &&
        session.payment_intent !== null
        ? {
            kind: 'paid',
            vendorPaymentIntentId: session.payment_intent.id,
            receiptUrl:
              session.payment_intent.latest_charge?.receipt_url ?? null,
          }
        : mismatch;
  }
}
