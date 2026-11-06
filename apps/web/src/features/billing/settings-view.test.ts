import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  billingSettingsView,
  type BillingSettingsSource,
} from './settings-view';
setupRitewayBun();
const source: BillingSettingsSource = {
  now: '2026-11-06T00:00:00.000Z',
  evidence: null,
  hasCustomer: true,
  purchaseAllowed: true,
  botDebates: {
    kind: 'limited',
    remaining: 1,
    limit: 1,
    available: true,
    source: { kind: 'lifetime' },
  },
};
test('dark purchase release preserves billing management and honest lifetime usage', () => {
  const view = billingSettingsView({
    source,
    configured: true,
    purchaseVisible: false,
  });
  assert({
    given: 'a retained customer and a dark new-purchase gate',
    should: 'keep management available and free use lifetime-bound',
    actual: [view.checkoutAvailable, view.manageAvailable, view.botDebates],
    expected: [
      false,
      true,
      {
        kind: 'limited',
        remaining: 1,
        limit: 1,
        available: true,
        scope: 'lifetime',
        endsAt: null,
      },
    ],
  });
});
test('unavailable usage never becomes an invented remaining balance', () => {
  assert({
    given: 'a refused allowance projection with billing unconfigured',
    should: 'show usage unavailable and offer no vendor action',
    actual: billingSettingsView({
      source: { ...source, botDebates: { kind: 'unavailable' } },
      configured: false,
      purchaseVisible: true,
    }),
    expected: {
      plan: 'free',
      accessEndsAt: null,
      checkoutAvailable: false,
      manageAvailable: false,
      botDebates: { kind: 'unavailable' },
    },
  });
});
