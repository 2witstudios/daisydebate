import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  checkoutParameters,
  normalizeCheckoutSession,
} from './checkout-session';
import { purchase, checkoutSession } from './checkout.test-support';
setupRitewayBun();

test('Checkout parameters are fully server-owned and stable across recovery', () => {
  const first = checkoutParameters(purchase);
  const recovered = checkoutParameters({
    ...purchase,
    state: {
      kind: 'unknown',
      afterSessionId: null,
      startedAt: '2026-11-05T00:00:01.000Z',
      retryAt: '2026-11-05T00:02:00.000Z',
    },
  });
  assert({
    given: 'one frozen admission and a later recovered claim',
    should:
      'send the same price, quantity, mode, tax, URLs, metadata and fixed expiry',
    actual: [first, recovered],
    expected: Array.from({ length: 2 }, () => ({
      mode: 'subscription',
      ui_mode: 'hosted_page',
      line_items: [{ price: purchase.priceId, quantity: 1 }],
      allowed_payment_method_types: ['card'],
      automatic_tax: { enabled: true },
      client_reference_id: purchase.id,
      metadata: { daisy_purchase_id: purchase.id },
      subscription_data: { metadata: { daisy_purchase_id: purchase.id } },
      success_url: checkoutSession.success_url,
      cancel_url: checkoutSession.cancel_url,
      expires_at: checkoutSession.expires_at,
      expand: ['line_items.data.price'],
    })),
  });
  assert({
    given: 'a verified existing customer from the admitted account',
    should: 'reuse that frozen customer instead of creating a second mapping',
    actual: checkoutParameters({ ...purchase, customerId: 'cus_existing' })
      .customer,
    expected: 'cus_existing',
  });
});

test('verified Checkout completion identifies a subscription without claiming that it is paid', () => {
  assert({
    given:
      'open, complete and expired observations of the owned fixed-price session',
    should:
      'return minimal verified identities and expose a hosted URL only while open',
    actual: [
      normalizeCheckoutSession(purchase, checkoutSession),
      normalizeCheckoutSession(purchase, {
        ...checkoutSession,
        status: 'complete',
        customer: 'cus_owned',
        subscription: 'sub_owned',
        url: null,
        payment_status: 'unpaid',
      }),
      normalizeCheckoutSession(purchase, {
        ...checkoutSession,
        status: 'expired',
        url: null,
      }),
    ],
    expected: [
      {
        kind: 'observed',
        session: { kind: 'open', id: checkoutSession.id, customerId: null },
        url: checkoutSession.url,
      },
      {
        kind: 'observed',
        session: {
          kind: 'complete',
          id: checkoutSession.id,
          customerId: 'cus_owned',
          subscriptionId: 'sub_owned',
        },
        url: null,
      },
      {
        kind: 'observed',
        session: { kind: 'expired', id: checkoutSession.id, customerId: null },
        url: null,
      },
    ],
  });
});

test('forged session authority, altered offers and unsafe redirects are refused', () => {
  const price = checkoutSession.line_items.data[0]!.price;
  const withPrice = (delta: Record<string, unknown>) => ({
    ...checkoutSession,
    line_items: {
      ...checkoutSession.line_items,
      data: [{ quantity: 1, price: { ...price, ...delta } }],
    },
  });
  const invalid = [
    { ...checkoutSession, client_reference_id: 'b'.repeat(24) },
    { ...checkoutSession, metadata: { daisy_purchase_id: 'b'.repeat(24) } },
    { ...checkoutSession, mode: 'payment' },
    { ...checkoutSession, livemode: true },
    { ...checkoutSession, id: 'cs_live_owned' },
    { ...checkoutSession, success_url: 'https://attacker.example/' },
    { ...checkoutSession, cancel_url: 'https://attacker.example/' },
    { ...checkoutSession, expires_at: checkoutSession.expires_at + 1 },
    { ...checkoutSession, created: checkoutSession.created + 300 },
    { ...checkoutSession, created: checkoutSession.created - 2 },
    { ...checkoutSession, automatic_tax: { enabled: false } },
    { ...checkoutSession, after_expiration: { recovery: { enabled: true } } },
    { ...checkoutSession, recovered_from: 'cs_test_other' },
    { ...checkoutSession, total_details: { amount_discount: 1 } },
    {
      ...checkoutSession,
      line_items: { ...checkoutSession.line_items, has_more: true },
    },
    {
      ...checkoutSession,
      line_items: {
        ...checkoutSession.line_items,
        data: [{ quantity: 2, price }],
      },
    },
    withPrice({ id: 'price_other' }),
    withPrice({ unit_amount: 100 }),
    withPrice({ currency: 'eur' }),
    withPrice({ livemode: true }),
    withPrice({
      recurring: {
        interval: 'year',
        interval_count: 1,
        usage_type: 'licensed',
      },
    }),
    {
      ...checkoutSession,
      url: 'https://checkout.stripe.com.attacker.example/c/pay/cs_test_owned',
    },
    {
      ...checkoutSession,
      url: 'https://checkout.stripe.com/c/pay/cs_test_other',
    },
    {
      ...checkoutSession,
      url: 'https://user:password@checkout.stripe.com/c/pay/cs_test_owned',
    },
    {
      ...checkoutSession,
      status: 'complete',
      customer: null,
      subscription: 'sub_owned',
      url: null,
    },
    { ...checkoutSession, subscription: 'sub_unexpected' },
  ];
  assert({
    given:
      'one altered authority, price, deadline, recovery or redirect field per observation',
    should: 'refuse every candidate before any mapping or redirect can be used',
    actual: invalid.map(
      (value) => normalizeCheckoutSession(purchase, value).kind,
    ),
    expected: invalid.map(() => 'refuse'),
  });
  assert({
    given:
      'a response that names another customer than the frozen existing mapping',
    should: 'refuse even when every other offer and session field matches',
    actual: normalizeCheckoutSession(
      { ...purchase, customerId: 'cus_existing' },
      { ...checkoutSession, customer: 'cus_other' },
    ),
    expected: { kind: 'refuse' },
  });
});
