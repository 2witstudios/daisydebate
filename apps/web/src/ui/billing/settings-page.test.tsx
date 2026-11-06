import { renderToString } from 'react-dom/server';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { BillingSettingsPage } from './settings-page';
import type { BillingSettings } from '../../features/billing/settings-view';
setupRitewayBun();
const settings: BillingSettings = {
  plan: 'free',
  accessEndsAt: null,
  checkoutAvailable: false,
  manageAvailable: true,
  botDebates: {
    kind: 'limited',
    remaining: 0,
    limit: 1,
    scope: 'lifetime',
    endsAt: null,
    available: false,
  },
};
test('a dark purchase release retains native management and honest usage upsell', () => {
  const html = renderToString(<BillingSettingsPage settings={settings} />);
  assert({
    given:
      'a managed account with no remaining free debate and dark new purchases',
    should:
      'offer management as a native post and keep the original lifetime scope',
    actual: [
      html.includes('action="/api/billing/portal" method="post"'),
      html.includes('action="/api/billing/checkout"'),
      html.includes('debates remaining'),
      html.includes('one lifetime allowance'),
      html.includes('Explore Premium'),
    ],
    expected: [true, false, true, true, true],
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
test('released purchases are plain POST forms and an outage invents no allowance', () => {
  const checkout = renderToString(
    <BillingSettingsPage settings={{ ...settings, checkoutAvailable: true }} />,
  );
  const failed = renderToString(<BillingSettingsPage settings={null} />);
  assert({
    given: 'an available purchase or a failed billing read',
    should:
      'use native post without hidden payment authority and show the failed read honestly',
    actual: [
      checkout.includes('action="/api/billing/checkout" method="post"'),
      checkout.includes('<input'),
      failed.includes('Billing unavailable'),
      failed.includes('debates remaining'),
    ],
    expected: [true, false, true, false],
  });
});
