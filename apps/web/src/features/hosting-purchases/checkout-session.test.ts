import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  hostingCheckoutParameters,
  observeHostingSession,
  verifiedHostingPrice,
  type HostingCheckoutPurchase,
} from './checkout-session';

setupRitewayBun();

const purchase: HostingCheckoutPurchase = {
  id: 'p'.padEnd(24, '1'),
  lobbyId: 'l'.padEnd(24, '1'),
  tier: 'event_64',
  amount: 9900,
  mode: 'test',
  vendorSessionId: 'cs_test_abc',
};
const price = (overrides: Record<string, unknown> = {}) => ({
  id: 'price_host64',
  object: 'price',
  active: true,
  currency: 'usd',
  livemode: false,
  type: 'one_time',
  unit_amount: 9900,
  lookup_key: 'daisy_host_event_usd_99',
  product: 'prod_host',
  ...overrides,
});
const session = (overrides: Record<string, unknown> = {}) => ({
  object: 'checkout.session',
  id: 'cs_test_abc',
  livemode: false,
  mode: 'payment',
  status: 'complete',
  payment_status: 'paid',
  client_reference_id: purchase.id,
  metadata: {
    daisy_hosting_purchase_id: purchase.id,
    daisy_lobby_id: purchase.lobbyId,
  },
  currency: 'usd',
  amount_subtotal: 9900,
  url: null,
  payment_intent: {
    id: 'pi_123',
    latest_charge: { receipt_url: 'https://pay.stripe.com/receipts/abc' },
  },
  ...overrides,
});

test('verifiedHostingPrice', () => {
  assert({
    given: 'the configured USD 99 price as Stripe returns it',
    should: 'accept it with its product',
    actual: verifiedHostingPrice('event_64', 'test', price()),
    expected: { id: 'price_host64', product: 'prod_host' },
  });
  assert({
    given: 'a price with the wrong amount, lookup key, mode or kind',
    should: 'refuse each',
    actual: [
      verifiedHostingPrice('event_64', 'test', price({ unit_amount: 9800 })),
      verifiedHostingPrice('event_64', 'test', price({ lookup_key: 'other' })),
      verifiedHostingPrice('event_64', 'live', price()),
      verifiedHostingPrice('event_64', 'test', price({ type: 'recurring' })),
      verifiedHostingPrice('event_unlimited', 'test', price()),
    ],
    expected: [null, null, null, null, null],
  });
});

test('hostingCheckoutParameters', () => {
  const returns = {
    successUrl: 'https://daisy.test/host/tournaments/cup/billing?purchase=1',
    cancelUrl: 'https://daisy.test/host/tournaments/cup/upgrade',
  };
  assert({
    given: 'a full-price upgrade',
    should: 'sell the configured price once in a payment session',
    actual: hostingCheckoutParameters(
      purchase,
      { kind: 'price', id: 'price_host64' },
      returns,
    ),
    expected: {
      mode: 'payment',
      ui_mode: 'hosted_page',
      line_items: [{ price: 'price_host64', quantity: 1 }],
      allowed_payment_method_types: ['card'],
      client_reference_id: purchase.id,
      metadata: {
        daisy_hosting_purchase_id: purchase.id,
        daisy_lobby_id: purchase.lobbyId,
      },
      payment_intent_data: {
        metadata: {
          daisy_hosting_purchase_id: purchase.id,
          daisy_lobby_id: purchase.lobbyId,
        },
      },
      success_url: returns.successUrl,
      cancel_url: returns.cancelUrl,
    },
  });
  assert({
    given: 'the move from USD 99 to unlimited',
    should: 'charge only the difference against the unlimited product',
    actual: hostingCheckoutParameters(
      { ...purchase, tier: 'event_unlimited', amount: 10000 },
      { kind: 'difference', product: 'prod_unlimited' },
      returns,
    ).line_items,
    expected: [
      {
        price_data: {
          currency: 'usd',
          product: 'prod_unlimited',
          unit_amount: 10000,
        },
        quantity: 1,
      },
    ],
  });
});

test('observeHostingSession', () => {
  assert({
    given: 'the stored session, complete and paid for the right amount',
    should: 'settle it paid with its payment intent and receipt',
    actual: observeHostingSession(purchase, session()),
    expected: {
      kind: 'paid',
      vendorPaymentIntentId: 'pi_123',
      receiptUrl: 'https://pay.stripe.com/receipts/abc',
    },
  });
  assert({
    given: 'an open and an expired session',
    should: 'read them as open with its URL and as expired',
    actual: [
      observeHostingSession(
        purchase,
        session({
          status: 'open',
          payment_status: 'unpaid',
          payment_intent: null,
          url: 'https://checkout.stripe.com/c/pay/cs_test_abc',
        }),
      ),
      observeHostingSession(
        purchase,
        session({
          status: 'expired',
          payment_status: 'unpaid',
          payment_intent: null,
        }),
      ),
    ],
    expected: [
      { kind: 'open', url: 'https://checkout.stripe.com/c/pay/cs_test_abc' },
      { kind: 'expired' },
    ],
  });
  assert({
    given:
      'a session for another purchase, tournament, amount or mode, another session id, or one complete but unpaid',
    should: 'settle nothing',
    actual: [
      session({ client_reference_id: 'x'.padEnd(24, '1') }),
      session({
        metadata: {
          daisy_hosting_purchase_id: purchase.id,
          daisy_lobby_id: 'o'.padEnd(24, '1'),
        },
      }),
      session({ amount_subtotal: 100 }),
      session({ livemode: true }),
      session({ id: 'cs_test_other' }),
      session({ payment_status: 'unpaid' }),
      session({ mode: 'subscription' }),
    ].map((raw) => observeHostingSession(purchase, raw).kind),
    expected: Array(7).fill('mismatch'),
  });
});
