import { renderToString } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { BillingSettingsPage } from './settings-page';
import type { BillingSettings } from '../../features/billing/settings-view';
setupRitewayBun();
const settings: BillingSettings = {
  plan: 'free',
  accessEndsAt: null,
  priceMinor: null,
  club: null,
  checkoutAvailable: false,
  manageAvailable: true,
};
const endsAt = '2026-12-17T00:00:00.000Z';
const premium: BillingSettings = {
  ...settings,
  plan: 'premium',
  accessEndsAt: endsAt,
  priceMinor: 2000,
};
const words = (html: string) =>
  html.replace(/<[^>]*>/g, '').replace(/&#x27;/g, "'");

test('billing never shows a usage counter or the old Explore Premium link', () => {
  const pages = [
    settings,
    premium,
    { ...premium, plan: 'cancelled' as const },
    { ...settings, checkoutAvailable: true },
  ].map((value) => words(renderToString(<BillingSettingsPage settings={value} />)));
  assert({
    given: 'free, paying, cancelled and purchasable accounts',
    should: 'show no Bot debates panel, no remaining count and no Explore Premium',
    actual: pages.map((text) =>
      /Bot debates|remaining|Explore Premium|\d+ of \d+/.test(text),
    ),
    expected: [false, false, false, false],
  });
});

test('paying yourself shows the price, the renewal date and management', () => {
  const html = renderToString(<BillingSettingsPage settings={premium} />);
  assert({
    given: 'a $20 subscriber renewing on 17 Dec 2026',
    should: 'show the price, the date and a native portal post with terms',
    actual: [
      html.includes('Daisy Premium'),
      words(html).includes('$20/month'),
      words(html).includes('Renews 17 Dec 2026.'),
      html.includes('action="/api/billing/portal" method="post"'),
      words(html).includes('Manage billing or cancel'),
      html.includes('href="/premium"'),
    ],
    expected: [true, true, true, true, true, true],
  });
});

test('a grandfathered subscriber sees their own price', () => {
  assert({
    given: 'a subscriber who kept the $10 price',
    should: 'show $10/month, not the new price',
    actual: words(
      renderToString(
        <BillingSettingsPage settings={{ ...premium, priceMinor: 1000 }} />,
      ),
    ).includes('$10/month'),
    expected: true,
  });
});

test('cancelled shows when Premium ends and offers to keep it', () => {
  const text = words(
    renderToString(
      <BillingSettingsPage settings={{ ...premium, plan: 'cancelled' }} />,
    ),
  );
  assert({
    given: 'renewal turned off with paid access through 17 Dec 2026',
    should: 'say so, keep the work theirs, and offer Keep Premium and Manage billing',
    actual: [
      text.includes('Daisy Premium · cancelled'),
      text.includes('Renewal is off. Premium stays on until 17 Dec 2026'),
      text.includes('Your analysis and Recordings stay yours after that.'),
      text.includes('Keep Premium'),
      text.includes('Manage billing'),
    ],
    expected: [true, true, true, true, true],
  });
});

test('a club seat has nothing to manage', () => {
  const text = words(
    renderToString(
      <BillingSettingsPage
        settings={{
          ...premium,
          plan: 'club-seat',
          priceMinor: null,
          club: { name: 'Northside Debate Club', coach: 'Ms. R. Okafor' },
        }}
      />,
    ),
  );
  assert({
    given: 'Premium paid by a club',
    should: 'name the club and coach and offer no billing management',
    actual: [
      text.includes('Seat from Northside Debate Club'),
      text.includes('Coach: Ms. R. Okafor'),
      text.includes('nothing to manage here'),
      text.includes('Manage billing'),
    ],
    expected: [true, true, true, false],
  });
});

test('the checkout return confirms only from current Premium evidence', () => {
  const confirmed = words(
    renderToString(<BillingSettingsPage settings={premium} returned />),
  );
  const pending = words(
    renderToString(<BillingSettingsPage settings={settings} returned />),
  );
  assert({
    given: 'a return with Premium evidence, and a return still unpaid',
    should: 'show You have Premium with the price and date, or the pending notice',
    actual: [
      confirmed.includes('You have Premium'),
      confirmed.includes('Payment confirmed. $20/month, renewing 17 Dec 2026.'),
      confirmed.includes('Debate a bot'),
      pending.includes('You have Premium'),
      pending.includes('Your purchase is being checked.'),
    ],
    expected: [true, true, true, false, true],
  });
});

test('purchase return claims cannot render confirmed Premium or leak into page copy', () => {
  const html = renderToString(
    <BillingSettingsPage settings={settings} notice="cs_test_claimed_paid" />,
  );
  assert({
    given: 'an unrecognized notice and unpaid current server evidence',
    should: 'retain Free account and ignore the supplied claim',
    actual: [
      html.includes('Free account'),
      html.includes('cs_test_claimed_paid'),
      html.includes('Daisy Premium'),
    ],
    expected: [true, false, false],
  });
});

test('released purchases are plain POST forms at the new price', () => {
  const checkout = renderToString(
    <BillingSettingsPage settings={{ ...settings, checkoutAvailable: true }} />,
  );
  const failed = renderToString(<BillingSettingsPage settings={null} />);
  assert({
    given: 'an available purchase or a failed billing read',
    should:
      'use a native post at $20/month without hidden payment authority and show the failed read honestly',
    actual: [
      checkout.includes('action="/api/billing/checkout" method="post"'),
      words(checkout).includes('Get Premium · $20/month'),
      checkout.includes('<input'),
      failed.includes('Billing unavailable'),
    ],
    expected: [true, true, false, true],
  });
});
