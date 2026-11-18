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
  renewalOff: false,
  amountMinor: null,
};
test('dark purchase release preserves billing management and shows no counter', () => {
  const view = billingSettingsView({
    source,
    configured: true,
    purchaseVisible: false,
  });
  assert({
    given: 'a retained customer and a dark new-purchase gate',
    should: 'keep management available and carry no usage at all',
    actual: view,
    expected: {
      plan: 'free',
      accessEndsAt: null,
      priceMinor: null,
      club: null,
      checkoutAvailable: false,
      manageAvailable: true,
    },
  });
});
test('unconfigured billing offers no vendor action', () => {
  assert({
    given: 'billing unconfigured with a visible purchase release',
    should: 'offer neither checkout nor management',
    actual: billingSettingsView({
      source,
      configured: false,
      purchaseVisible: true,
    }),
    expected: {
      plan: 'free',
      accessEndsAt: null,
      priceMinor: null,
      club: null,
      checkoutAvailable: false,
      manageAvailable: false,
    },
  });
});

test('paid access remains through its verified period and expires at the end even while vendor status stays active', () => {
  const endsAt = '2026-12-01T00:00:00.000Z';
  const paid = {
    ...source,
    purchaseAllowed: false,
    evidence: {
      lifecycle: 'active' as const,
      settlement: {
        kind: 'paid' as const,
        invoiceId: 'in_paid',
        period: {
          subscriptionId: 'sub_owned',
          startsAt: '2026-11-01T00:00:00.000Z',
          endsAt,
        },
      },
    },
  };
  const before = billingSettingsView({
    source: paid,
    configured: true,
    purchaseVisible: false,
  });
  const after = billingSettingsView({
    source: { ...paid, now: endsAt },
    configured: true,
    purchaseVisible: false,
  });
  assert({
    given: 'retained verified payment after cancel-at-period-end is requested',
    should:
      'preserve paid-through display and management without extending the interval from vendor active',
    actual: [
      before.plan,
      before.accessEndsAt,
      after.plan,
      after.accessEndsAt,
      after.manageAvailable,
    ],
    expected: ['premium', endsAt, 'free', null, true],
  });
});

test('paying yourself, cancelled and grandfathered show their own price and state', () => {
  const endsAt = '2026-12-17T00:00:00.000Z';
  const paid: BillingSettingsSource = {
    ...source,
    now: '2026-11-20T00:00:00.000Z',
    purchaseAllowed: false,
    amountMinor: 2000,
    evidence: {
      lifecycle: 'active',
      settlement: {
        kind: 'paid',
        invoiceId: 'in_paid',
        period: {
          subscriptionId: 'sub_owned',
          startsAt: '2026-11-17T00:00:00.000Z',
          endsAt,
        },
      },
    },
  };
  const view = (over: Partial<BillingSettingsSource>) =>
    billingSettingsView({
      source: { ...paid, ...over },
      configured: true,
      purchaseVisible: true,
    });
  assert({
    given:
      'a $20 subscriber renewing, the same with renewal off, and a grandfathered $10 subscriber',
    should:
      'show premium, cancelled through the paid end, and each subscriber their own price',
    actual: [
      [view({}).plan, view({}).priceMinor, view({}).accessEndsAt],
      [
        view({ renewalOff: true }).plan,
        view({ renewalOff: true }).accessEndsAt,
      ],
      view({ amountMinor: 1000 }).priceMinor,
    ],
    expected: [['premium', 2000, endsAt], ['cancelled', endsAt], 1000],
  });
});
