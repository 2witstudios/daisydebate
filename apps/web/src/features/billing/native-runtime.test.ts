import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fixedClock } from '@daisy/clock';
import { createAppError } from '@daisy/errors';
import { assertRejects } from '@daisy/errors/testing';
import { createNativeBillingRuntime } from './native-runtime';

setupRitewayBun();

test('changing or failed display Flags cannot substitute for durable admission or disable management', async () => {
  const subject = { userId: 'u'.repeat(24), actorId: 'a'.repeat(24) };
  let release: boolean | 'unavailable' = true;
  let admissions = 0;
  let portalCalls = 0;
  const runtime = createNativeBillingRuntime({
    returnOrigin: 'https://daisy.example',
    clock: fixedClock('2026-11-06T00:00:00.000Z'),
    vendor: {
      kind: 'stripe',
      config: {
        kind: 'stripe',
        mode: 'test',
        secretKey: 'sk_test_unused',
        webhookSecret: 'whsec_unused',
        premiumPriceId: 'price_fixture',
        portalConfigurationId: 'bpc_fixture',
      },
      checkout: {
        create: async () => {
          throw Error('Admission must precede vendor work');
        },
        retrieve: async () => {
          throw Error('Unexpected vendor work');
        },
        expire: async () => {
          throw Error('Unexpected vendor work');
        },
        list: async () => {
          throw Error('Unexpected vendor work');
        },
      },
      portal: async (parameters) => {
        portalCalls++;
        return {
          ...parameters,
          object: 'billing_portal.session',
          id: 'bps_owned',
          livemode: false,
          url: 'https://billing.stripe.com/p/session/test_owned',
        };
      },
    },
    release: async () => {
      if (release === 'unavailable') throw Error('Flag snapshot unavailable');
      return release;
    },
    memberStore: {
      portalCustomer: async () => ({ id: 'cus_owned', mode: 'test' }),
      read: async () => ({
        now: '2026-11-06T00:00:00.000Z',
        evidence: null,
        hasCustomer: true,
        purchaseAllowed: true,
        botDebates: { kind: 'unavailable' },
      }),
    },
    admit: async () => {
      admissions++;
      throw createAppError('AUTHORIZATION');
    },
    purchaseStore: {
      recover: async () => {
        throw Error('No admitted purchase');
      },
      record: async () => {
        throw Error('No admitted purchase');
      },
      read: async () => {
        throw Error('No admitted purchase');
      },
    },
  });
  const visible = await runtime.settings(subject);
  release = false;
  const killed = await runtime.settings(subject);
  release = 'unavailable';
  const unavailable = await runtime.settings(subject);
  const portal = await runtime.portal(subject);
  await assertRejects({
    given: 'a direct POST after display release changed or failed',
    should: 'reach the independent durable authority and preserve its refusal',
    code: 'AUTHORIZATION',
    actual: () => runtime.checkout(subject),
  });
  assert({
    given: 'one runtime across successive request display decisions',
    should:
      'refresh purchase display while keeping current owned Portal independent',
    actual: [
      visible.checkoutAvailable,
      killed.checkoutAvailable,
      unavailable.checkoutAvailable,
      unavailable.manageAvailable,
      portal,
      admissions,
      portalCalls,
    ],
    expected: [
      true,
      false,
      false,
      true,
      {
        kind: 'redirect',
        url: 'https://billing.stripe.com/p/session/test_owned',
      },
      1,
      1,
    ],
  });
});
