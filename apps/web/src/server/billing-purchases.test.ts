import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fixedClock } from '@daisy/clock';
import { createId } from '@paralleldrive/cuid2';
import { createApp } from './app';
import { startBillingPurchases } from './billing-purchases';
import { authTestEnv } from '../features/auth/auth-server.test-support';
import { betaMessagingPolicy } from '../features/messaging/beta-policy';
import {
  purchase,
  checkoutSession,
} from '../features/billing/checkout.test-support';
import type { BillingFetch } from './billing-stripe';

setupRitewayBun();
test('scheduled SDK recovery discovers the original closed attempt without creating or repricing it', async () => {
  const now = '2026-11-06T12:00:00.000Z';
  const app = createApp({
    env: {
      ...authTestEnv,
      DATABASE_URL: 'postgres://unit:unit@localhost:5432/unit',
      REDIS_URL: 'redis://localhost:6379',
      REDIS_NAMESPACE: 'billing-purchase-unit',
      LOG_LEVEL: 'silent',
    },
    messagingPolicy: betaMessagingPolicy,
    clock: fixedClock(now),
    ids: { next: createId },
    fetch: async () => {
      throw Error('Unexpected transport');
    },
  });
  const requests: unknown[] = [],
    records: unknown[] = [],
    calls: unknown[] = [];
  let tick: () => Promise<void> = async () => undefined;
  const session = {
    ...checkoutSession,
    status: 'complete',
    customer: 'cus_original',
    subscription: 'sub_original',
    url: null,
  };
  const fetch: BillingFetch = Object.assign(
    async (
      input: Parameters<BillingFetch>[0],
      init?: Parameters<BillingFetch>[1],
    ) => {
      const url = new URL(String(input));
      requests.push([init?.method ?? 'GET', url.pathname]);
      return Response.json(
        url.pathname === '/v1/checkout/sessions'
          ? { object: 'list', data: [session], has_more: false }
          : session,
      );
    },
    { preconnect() {} },
  );
  const store: ReturnType<typeof app.database.billingPurchaseRecovery> = {
    purchases: async (input) => {
      calls.push(input);
      return {
        rows: [{ purchaseId: purchase.id }],
        afterId: null,
        exhausted: true,
      };
    },
    inspect: async () => ({
      purchase,
      context: { now, authority: 'closed' },
      closedAt: '2026-11-05T00:02:00.000Z',
      work: 'cleanup',
    }),
    record: async (id, event) => {
      records.push([id, event]);
      return 'changed';
    },
  };
  const service = startBillingPurchases({
    app: {
      ...app,
      config: {
        ...app.config,
        billing: {
          kind: 'stripe',
          mode: 'test',
          secretKey: 'sk_test_fixture',
          webhookSecret: 'whsec_fixture',
          premiumPriceId: 'price_replacement',
          portalConfigurationId: 'bpc_fixture',
        },
      },
      database: {
        ...app.database,
        billingPurchaseRecovery: (instanceId) => {
          calls.push(instanceId);
          return store;
        },
      },
    },
    instanceId: 'current-service-fixture',
    fetch,
    timers: {
      setInterval: (run, ms) => {
        tick = run;
        calls.push(ms);
        return 1;
      },
      clearInterval: () => {
        calls.push('clear');
      },
    },
  })!;
  await service.started;
  await service.stop();
  await tick();
  assert({
    given:
      'a closed original priceA attempt and replacement new-purchase configB',
    should:
      'perform only bounded original Session reads and retain its exact positive effect through current-service recovery',
    actual: [calls, requests, records],
    expected: [
      ['current-service-fixture', 5000, { mode: 'test', limit: 3 }, 'clear'],
      [
        ['GET', '/v1/checkout/sessions'],
        ['GET', `/v1/checkout/sessions/${session.id}`],
      ],
      [
        [
          purchase.id,
          {
            kind: 'observe',
            session: {
              kind: 'complete',
              id: session.id,
              customerId: session.customer,
              subscriptionId: session.subscription,
            },
          },
        ],
      ],
    ],
  });
});
