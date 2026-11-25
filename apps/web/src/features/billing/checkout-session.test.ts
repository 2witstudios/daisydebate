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
      normalizeCheckoutSession(purchase, checkoutSession, 'subscribed'),
      normalizeCheckoutSession(
        purchase,
        {
          ...checkoutSession,
          status: 'complete',
          customer: 'cus_owned',
          subscription: 'sub_owned',
          url: null,
          payment_status: 'unpaid',
        },
        'subscribed',
      ),
      normalizeCheckoutSession(
        purchase,
        {
          ...checkoutSession,
          status: 'expired',
          url: null,
        },
        'subscribed',
      ),
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

test('an open session redirects under either hosted path Stripe has served', () => {
  const urls = ['c', 'g', 'z'].map(
    (prefix) =>
      `https://checkout.stripe.com/${prefix}/pay/${checkoutSession.id}#opaque-test-value`,
  );
  assert({
    given:
      'the owned open session at /c/pay/, at /g/pay/ and at another one-letter prefix',
    should: 'expose the URL Stripe returned, unchanged, for each',
    actual: urls.map((url) => {
      const observed = normalizeCheckoutSession(
        purchase,
        { ...checkoutSession, url },
        'current',
      );
      return observed.kind === 'observed' ? observed.url : observed.kind;
    }),
    expected: urls,
  });
});

test('the redirect is the parsed URL that was checked, never the raw string', () => {
  const observed = normalizeCheckoutSession(
    purchase,
    {
      ...checkoutSession,
      url: 'https://checkout.stripe.com/x/../g/pay/cs_test_owned',
    },
    'current',
  );
  assert({
    given:
      'a Stripe-origin URL whose dot segments resolve to the owned session',
    should: 'redirect to the resolved URL',
    actual: observed.kind === 'observed' ? observed.url : observed.kind,
    expected: 'https://checkout.stripe.com/g/pay/cs_test_owned',
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
    { ...checkoutSession, amount_subtotal: 1000 },
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
      url: 'https://checkout.stripe.com/g/pay/cs_test_other',
    },
    {
      ...checkoutSession,
      url: 'https://checkout.stripe.com/pay/cs_test_owned',
    },
    {
      ...checkoutSession,
      url: 'https://checkout.stripe.com/go/pay/cs_test_owned',
    },
    {
      ...checkoutSession,
      url: 'https://checkout.stripe.com/G/pay/cs_test_owned',
    },
    {
      ...checkoutSession,
      url: 'https://checkout.stripe.com/1/pay/cs_test_owned',
    },
    {
      ...checkoutSession,
      url: 'https://checkout.stripe.com/%67/pay/cs_test_owned',
    },
    {
      ...checkoutSession,
      url: 'https://checkout.stripe.com/g/pay/cs_test_owned/extra',
    },
    {
      ...checkoutSession,
      url: 'https://checkout.stripe.com/g/setup/cs_test_owned',
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
      (value) => normalizeCheckoutSession(purchase, value, 'subscribed').kind,
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
      'subscribed',
    ),
    expected: { kind: 'refuse' },
  });
});

test('a new Checkout sells only the $20 offer; an existing $10 session still completes', () => {
  const price = checkoutSession.line_items.data[0]!.price;
  const at = (delta: Record<string, unknown>, subtotal = 2000) => ({
    ...checkoutSession,
    amount_subtotal: subtotal,
    line_items: {
      ...checkoutSession.line_items,
      data: [{ quantity: 1, price: { ...price, ...delta } }],
    },
  });
  const grandfathered = at({ unit_amount: 1000, lookup_key: null }, 1000);
  assert({
    given:
      'a created session at $20, at $10, at $20 without or with another lookup key, and an existing $10 session read back',
    should:
      'create only at the current offer, and read back the $10 session opened before the price changed (PYL-9)',
    actual: [
      normalizeCheckoutSession(purchase, at({}), 'current').kind,
      normalizeCheckoutSession(purchase, grandfathered, 'current').kind,
      normalizeCheckoutSession(purchase, at({ lookup_key: null }), 'current')
        .kind,
      normalizeCheckoutSession(
        purchase,
        at({ lookup_key: 'daisy_premium_monthly_usd_10' }),
        'current',
      ).kind,
      normalizeCheckoutSession(purchase, grandfathered, 'subscribed').kind,
    ],
    expected: ['observed', 'refuse', 'refuse', 'refuse', 'observed'],
  });
});

test('a Club checkout sells its seat count at exactly the Club price (ADR 0148)', () => {
  const organizationId = 'o'.repeat(24);
  const club = {
    ...purchase,
    owner: { kind: 'organization' as const, organizationId },
    quantity: 14,
  };
  const price = {
    ...checkoutSession.line_items.data[0]!.price,
    unit_amount: 1000,
    lookup_key: 'daisy_club_seat_monthly_usd_10',
  };
  const session = (delta: {
    quantity?: number;
    amount?: number;
    price?: object;
  }) => ({
    ...checkoutSession,
    success_url: `${purchase.returnOrigin}/clubs/${organizationId}/billing?purchase=${purchase.id}`,
    cancel_url: `${purchase.returnOrigin}/clubs/${organizationId}/billing`,
    amount_subtotal: delta.amount ?? 14000,
    line_items: {
      ...checkoutSession.line_items,
      data: [{ quantity: delta.quantity ?? 14, price: delta.price ?? price }],
    },
  });
  assert({
    given: 'a Club purchase of 14 seats',
    should:
      'ask Stripe for 14 of the Club price and return to the club billing page',
    actual: [
      checkoutParameters(club).line_items,
      checkoutParameters(club).cancel_url,
    ],
    expected: [
      [{ price: purchase.priceId, quantity: 14 }],
      `${purchase.returnOrigin}/clubs/${organizationId}/billing`,
    ],
  });
  assert({
    given:
      'the matching session, and ones with another quantity, total, or the Premium price',
    should: 'observe only the matching session',
    actual: [
      session({}),
      session({ quantity: 13, amount: 13000 }),
      session({ amount: 1000 }),
      session({
        price: checkoutSession.line_items.data[0]!.price,
        amount: 28000,
      }),
    ].map((value) => normalizeCheckoutSession(club, value, 'current').kind),
    expected: ['observed', 'refuse', 'refuse', 'refuse'],
  });
  assert({
    given: 'a Premium purchase read back with a 14-seat line',
    should: 'refuse it',
    actual: normalizeCheckoutSession(
      purchase,
      {
        ...checkoutSession,
        line_items: {
          ...checkoutSession.line_items,
          data: [
            { quantity: 14, price: checkoutSession.line_items.data[0]!.price },
          ],
        },
      },
      'current',
    ).kind,
    expected: 'refuse',
  });
});
