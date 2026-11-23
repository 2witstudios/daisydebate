import { virtualClock } from '@daisy/clock/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fixedClock } from '@daisy/clock';
import { createId } from '@paralleldrive/cuid2';
import { createApp } from '../../server/app';
import { startBillingPurchases } from './purchases-worker';
import { authTestEnv } from '../auth/auth-server.test-support';
import { betaMessagingPolicy } from '../messaging/beta-policy';
import { purchase, checkoutSession } from './checkout.test-support';
import type { BillingFetch } from './stripe-client';
import {
  manualWaits,
  recordingWaits,
} from '../../lib/manual-waits.test-support';

setupRitewayBun();
test('scheduled SDK recovery discovers the original closed attempt without creating or repricing it', async () => {
  const now = '2026-11-06T12:00:00.000Z';
  const app = createApp({
    waits: virtualClock(),
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
  const manual = manualWaits();
  const tick = async () => {
    await manual.tasks.get(5000)?.();
  };
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
          hostEventPrices: null,
          club: null,
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
    waits: recordingWaits(manual.waits, (event, ms) =>
      calls.push(event === 'armed' ? ms : 'clear'),
    ),
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
      ['current-service-fixture', { mode: 'test', limit: 3 }, 5000, 'clear'],
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
