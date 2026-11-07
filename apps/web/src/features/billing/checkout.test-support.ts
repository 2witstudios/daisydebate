import type { Purchase } from '@daisy/protocol/billing';
export const purchase: Purchase = {
  id: 'a'.repeat(24),
  userId: 'u'.repeat(24),
  mode: 'test',
  priceId: 'price_fixture',
  customerId: null,
  returnOrigin: 'https://daisy.example',
  admittedAt: '2026-11-05T00:00:00.500Z',
  state: {
    kind: 'creating',
    startedAt: '2026-11-05T00:00:01.000Z',
    claim: {
      id: 'c'.repeat(24),
      claimedAt: '2026-11-05T00:00:01.000Z',
      expiresAt: '2026-11-05T00:00:31.000Z',
    },
  },
};
export const checkoutSession = {
  object: 'checkout.session',
  id: 'cs_test_owned',
  livemode: false,
  mode: 'subscription',
  ui_mode: 'hosted_page',
  client_reference_id: purchase.id,
  metadata: { daisy_purchase_id: purchase.id },
  created: Math.floor(Date.parse(purchase.admittedAt) / 1000) + 1,
  expires_at: Math.floor(Date.parse(purchase.admittedAt) / 1000) + 3600,
  status: 'open',
  customer: null,
  subscription: null,
  currency: 'usd',
  amount_subtotal: 1000,
  automatic_tax: { enabled: true },
  allow_promotion_codes: null,
  after_expiration: null,
  recovered_from: null,
  total_details: { amount_discount: 0 },
  success_url: `${purchase.returnOrigin}/settings/billing?purchase=${purchase.id}`,
  cancel_url: `${purchase.returnOrigin}/settings/billing`,
  url: 'https://checkout.stripe.com/c/pay/cs_test_owned#opaque-test-value',
  line_items: {
    object: 'list',
    has_more: false,
    data: [
      {
        quantity: 1,
        price: {
          id: purchase.priceId,
          currency: 'usd',
          unit_amount: 1000,
          livemode: false,
          recurring: {
            interval: 'month',
            interval_count: 1,
            usage_type: 'licensed',
          },
        },
      },
    ],
  },
};
