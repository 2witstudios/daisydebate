import { assert, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../test-support/rendered/accessible';
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
const render = renderAccessible;
const words = (node: Parameters<typeof renderAccessible>[0]) =>
  render(node).textContent();
/** The native form a submit button posts. */
const formOf = (view: ReturnType<typeof render>, button: string) =>
  view.get('button', button).closest('form');

test('billing never shows a usage counter or the old Explore Premium link', () => {
  const pages = [
    settings,
    premium,
    { ...premium, plan: 'cancelled' as const },
    { ...settings, checkoutAvailable: true },
  ].map((value) => words(<BillingSettingsPage settings={value} />));
  assert({
    given: 'free, paying, cancelled and purchasable accounts',
    should:
      'show no Bot debates panel, no remaining count and no Explore Premium',
    actual: pages.map((text) =>
      /Bot debates|remaining|Explore Premium|\d+ of \d+/.test(text),
    ),
    expected: [false, false, false, false],
  });
});

test('paying yourself shows the price, the renewal date and management', () => {
  const view = render(<BillingSettingsPage settings={premium} />);
  const portal = formOf(view, 'Manage billing or cancel');
  assert({
    given: 'a $20 subscriber renewing on 17 Dec 2026',
    should: 'show the price, the date and a native portal post with terms',
    actual: [
      view.has('heading', 'Daisy Premium'),
      view.textContent().includes('$20/month'),
      view.textContent().includes('Renews 17 Dec 2026.'),
      [portal?.getAttribute('action'), portal?.getAttribute('method')],
      view.attribute('link', 'Premium features and terms', 'href'),
    ],
    expected: [true, true, true, ['/api/billing/portal', 'post'], '/premium'],
  });
});

test('a grandfathered subscriber sees their own price', () => {
  assert({
    given: 'a subscriber who kept the $10 price',
    should: 'show $10/month, not the new price',
    actual: words(
      <BillingSettingsPage settings={{ ...premium, priceMinor: 1000 }} />,
    ).includes('$10/month'),
    expected: true,
  });
});

test('cancelled shows when Premium ends and offers to keep it', () => {
  const view = render(
    <BillingSettingsPage settings={{ ...premium, plan: 'cancelled' }} />,
  );
  const text = view.textContent();
  assert({
    given: 'renewal turned off with paid access through 17 Dec 2026',
    should:
      'say so, keep the work theirs, and offer Keep Premium and Manage billing',
    actual: [
      view.has('heading', 'Daisy Premium · cancelled'),
      text.includes('Renewal is off. Premium stays on until 17 Dec 2026'),
      text.includes('Your analysis and Recordings stay yours after that.'),
      view.has('button', 'Keep Premium'),
      view.has('button', 'Manage billing'),
    ],
    expected: [true, true, true, true, true],
  });
});

test('a club seat has nothing to manage', () => {
  const view = render(
    <BillingSettingsPage
      settings={{
        ...premium,
        plan: 'club-seat',
        priceMinor: null,
        club: { name: 'Northside Debate Club', manager: 'Ms. R. Okafor' },
      }}
    />,
  );
  const text = view.textContent();
  assert({
    given: 'Premium paid by a club',
    should: 'name the club and coach and offer no billing management',
    actual: [
      text.includes('Seat from Northside Debate Club'),
      text.includes('Coach: Ms. R. Okafor'),
      text.includes('nothing to manage here'),
      text.includes('Manage billing'),
      view.count('button'),
    ],
    expected: [true, true, true, false, 0],
  });
});

test('the checkout return confirms only from current Premium evidence', () => {
  const confirmedView = render(
    <BillingSettingsPage settings={premium} returned />,
  );
  const confirmed = confirmedView.textContent();
  const confirmation = [
    confirmedView.within('status').has('heading', 'You have Premium'),
    confirmedView.attribute('link', 'Play a debate', 'href'),
    /\bbots?\b/i.test(confirmed),
  ];
  const pendingView = render(
    <BillingSettingsPage settings={settings} returned />,
  );
  const pending = pendingView.textContent();
  const pendingStatus = pendingView.text('status');
  assert({
    given: 'a return with Premium evidence, and a return still unpaid',
    should:
      'show You have Premium with the price and date and no bot debates, or the pending notice',
    actual: [
      confirmation,
      confirmed.includes('Payment confirmed. $20/month, renewing 17 Dec 2026.'),
      pending.includes('You have Premium'),
      pendingStatus.includes('Your purchase is being checked.'),
    ],
    expected: [[true, '/play', false], true, false, true],
  });
});

test('purchase return claims cannot render confirmed Premium or leak into page copy', () => {
  const view = render(
    <BillingSettingsPage settings={settings} notice="cs_test_claimed_paid" />,
  );
  assert({
    given: 'an unrecognized notice and unpaid current server evidence',
    should: 'retain Free account and ignore the supplied claim',
    actual: [
      view.has('heading', 'Free account'),
      view.textContent().includes('cs_test_claimed_paid'),
      view.textContent().includes('Daisy Premium'),
    ],
    expected: [true, false, false],
  });
});

test('released purchases are plain POST forms at the new price', () => {
  const checkout = render(
    <BillingSettingsPage settings={{ ...settings, checkoutAvailable: true }} />,
  );
  const purchase = formOf(checkout, 'Get Premium · $20/month');
  const checkoutFields = [
    purchase?.getAttribute('action'),
    purchase?.getAttribute('method'),
    // Every field the page posts: no input carries payment authority.
    checkout
      .all('button')
      .flatMap((button) => [
        ...(button.closest('form')?.querySelectorAll('input') ?? []),
      ]).length,
  ];
  const failed = render(<BillingSettingsPage settings={null} />);
  assert({
    given: 'an available purchase or a failed billing read',
    should:
      'use a native post at $20/month without hidden payment authority and show the failed read honestly',
    actual: [checkoutFields, failed.has('heading', 'Billing unavailable')],
    expected: [['/api/billing/checkout', 'post', 0], true],
  });
});

test('beta-granted Premium has nothing to pay and no checkout', () => {
  const text = words(
    <BillingSettingsPage settings={{ ...settings, plan: 'granted' }} />,
  );
  assert({
    given: 'Premium from beta access',
    should: 'say it is included and offer no purchase or counter',
    actual: [
      text.includes('Daisy Premium'),
      text.includes('included with your beta access'),
      text.includes('Get Premium'),
      text.includes('Free account'),
    ],
    expected: [true, true, false, false],
  });
});

test('the confirmation reads as one sentence whichever terms are known yet', () => {
  const confirm = (over: Partial<BillingSettings>) =>
    words(<BillingSettingsPage settings={{ ...premium, ...over }} returned />);
  assert({
    given:
      'a confirmed return with no price yet, and with neither price nor date',
    should: 'never print a stray comma or double full stop',
    actual: [
      confirm({ priceMinor: null }).includes(
        'Payment confirmed. Renewing 17 Dec 2026. A receipt',
      ),
      confirm({ priceMinor: null, accessEndsAt: null }).includes(
        'Payment confirmed. A receipt',
      ),
      /\.,|\.\./.test(confirm({ priceMinor: null })),
    ],
    expected: [true, true, false],
  });
});
