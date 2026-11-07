import type Stripe from 'stripe';
import { z } from 'zod';
import {
  purchaseBounds,
  purchaseSchema,
  purchaseSessionExpiry,
  type Purchase,
  type PurchaseObservation,
} from '@daisy/protocol/billing';
import { premiumPriceSchema } from './premium-price';

export function checkoutParameters(purchase: Purchase) {
  const metadata = { daisy_purchase_id: purchase.id };
  return {
    mode: 'subscription',
    ui_mode: 'hosted_page',
    line_items: [{ price: purchase.priceId, quantity: 1 }],
    allowed_payment_method_types: ['card'],
    automatic_tax: { enabled: true },
    ...(purchase.customerId === null ? {} : { customer: purchase.customerId }),
    client_reference_id: purchase.id,
    metadata,
    subscription_data: { metadata },
    success_url: `${purchase.returnOrigin}/settings/billing?purchase=${purchase.id}`,
    cancel_url: `${purchase.returnOrigin}/settings/billing`,
    expires_at: purchaseSessionExpiry(purchase),
    expand: ['line_items.data.price'],
  } satisfies Stripe.Checkout.SessionCreateParams;
}

const vendorId = (prefix: string) =>
  z
    .string()
    .regex(new RegExp(`^${prefix}_[A-Za-z0-9_]+$`))
    .max(255);
const seconds = z.number().int().nonnegative().max(8_640_000_000_000);
const sessionSchema = z.object({
  object: z.literal('checkout.session'),
  id: z
    .string()
    .regex(/^cs_(test|live)_[A-Za-z0-9_]+$/)
    .max(255),
  livemode: z.boolean(),
  mode: z.literal('subscription'),
  ui_mode: z.literal('hosted_page'),
  client_reference_id: z.string(),
  metadata: z.object({ daisy_purchase_id: z.string() }),
  created: seconds,
  expires_at: seconds,
  status: z.enum(['open', 'complete', 'expired']),
  customer: vendorId('cus').nullable(),
  subscription: vendorId('sub').nullable(),
  currency: z.literal('usd'),
  amount_subtotal: z.literal(1000),
  automatic_tax: z.object({ enabled: z.literal(true) }),
  allow_promotion_codes: z.union([z.literal(false), z.null()]),
  after_expiration: z.null(),
  recovered_from: z.null(),
  total_details: z.object({ amount_discount: z.literal(0) }),
  success_url: z.string(),
  cancel_url: z.string(),
  url: z.string().max(8192).nullable(),
  line_items: z.object({
    object: z.literal('list'),
    has_more: z.literal(false),
    data: z
      .array(z.object({ quantity: z.literal(1), price: premiumPriceSchema }))
      .length(1),
  }),
});
type Session = z.infer<typeof sessionSchema>;
export type CheckoutObservation =
  | {
      readonly kind: 'observed';
      readonly session: PurchaseObservation;
      readonly url: string | null;
    }
  | { readonly kind: 'refuse' };
const refuse = { kind: 'refuse' } as const;

function ownedSession(purchase: Purchase, session: Session) {
  return (
    session.client_reference_id === purchase.id &&
    session.metadata.daisy_purchase_id === purchase.id &&
    session.livemode === (purchase.mode === 'live') &&
    session.id.startsWith(`cs_${purchase.mode}_`) &&
    (purchase.customerId === null ||
      purchase.customerId === session.customer) &&
    (!('sessionId' in purchase.state) ||
      purchase.state.sessionId === session.id)
  );
}
function fixedOffer(purchase: Purchase, session: Session) {
  const parameters = checkoutParameters(purchase);
  const price = session.line_items.data[0]?.price;
  return (
    price?.id === purchase.priceId &&
    price.livemode === session.livemode &&
    session.success_url === parameters.success_url &&
    session.cancel_url === parameters.cancel_url &&
    session.expires_at === parameters.expires_at &&
    session.created >= Math.floor(Date.parse(purchase.admittedAt) / 1000) &&
    session.created <
      Math.ceil(
        (Date.parse(purchase.admittedAt) + purchaseBounds.creationMs) / 1000,
      )
  );
}
function hostedUrl(session: Session): string | null {
  if (session.url === null || !URL.canParse(session.url)) return null;
  const url = new URL(session.url);
  return url.origin === 'https://checkout.stripe.com' &&
    url.username === '' &&
    url.password === '' &&
    url.pathname === `/c/pay/${session.id}`
    ? session.url
    : null;
}
function completedSession(session: Session): CheckoutObservation {
  return session.customer && session.subscription && session.url === null
    ? {
        kind: 'observed',
        session: {
          kind: 'complete',
          id: session.id,
          customerId: session.customer,
          subscriptionId: session.subscription,
        },
        url: null,
      }
    : refuse;
}
function observedSession(session: Session): CheckoutObservation {
  if (session.status === 'complete') return completedSession(session);
  if (session.subscription !== null) return refuse;
  const url = session.status === 'open' ? hostedUrl(session) : null;
  if (session.status === 'open' && url === null) return refuse;
  if (session.status === 'expired' && session.url !== null) return refuse;
  return {
    kind: 'observed',
    session: {
      kind: session.status,
      id: session.id,
      customerId: session.customer,
    },
    url,
  };
}

/** A Checkout result identifies pending billing work; invoice evidence alone establishes paid access. */
export function normalizeCheckoutSession(
  purchase: Purchase,
  value: unknown,
): CheckoutObservation {
  if (
    !purchaseSchema.safeParse(purchase).success ||
    !('startedAt' in purchase.state)
  )
    return refuse;
  const parsed = sessionSchema.safeParse(value);
  if (
    !parsed.success ||
    !ownedSession(purchase, parsed.data) ||
    !fixedOffer(purchase, parsed.data)
  )
    return refuse;
  return observedSession(parsed.data);
}
