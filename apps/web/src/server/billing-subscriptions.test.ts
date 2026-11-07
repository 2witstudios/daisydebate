import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { fixedClock } from '@daisy/clock';
import { createApp } from './app';
import { startBillingSubscriptions } from './billing-subscriptions';
import { authTestEnv } from '../features/auth/auth-server.test-support';
import { betaMessagingPolicy } from '../features/messaging/beta-policy';
import {
  identity,
  subscription,
  invoice,
} from '../features/billing/subscription-observation.test-support';
import type { BillingFetch } from './billing-stripe';

setupRitewayBun();
const build = () =>
  createApp({
    env: {
      ...authTestEnv,
      DATABASE_URL: 'postgres://unit:unit@localhost:5432/unit',
      REDIS_URL: 'redis://localhost:6379',
      REDIS_NAMESPACE: 'billing-subscription-unit',
      LOG_LEVEL: 'silent',
    },
    messagingPolicy: betaMessagingPolicy,
    clock: fixedClock('2026-11-06T12:00:00.000Z'),
    ids: { next: createId },
    fetch: async () => {
      throw Error('Unexpected network');
    },
  });
const billing = {
  kind: 'stripe' as const,
  mode: 'test' as const,
  secretKey: 'sk_test_fixture',
  webhookSecret: 'whsec_fixture',
  premiumPriceId: 'price_replacement',
  portalConfigurationId: 'bpc_fixture',
};

function harness() {
  const app = build(),
    calls: string[] = [];
  const claim = {
    customerId: createId(),
    userId: createId(),
    vendorCustomerId: identity.customerId,
    mode: 'test' as const,
    subscriptionId: identity.subscriptionId,
    vendorSubscriptionId: identity.vendorSubscriptionId,
    priceId: identity.priceId,
    accountRevision: 1,
    revision: 1,
    claimId: createId(),
  };
  let tick: () => Promise<void> = async () => undefined,
    cadence = 0;
  const timers = {
    setInterval: (run: () => Promise<void>, ms: number) => {
      tick = run;
      cadence = ms;
      return 1;
    },
    clearInterval: () => {
      calls.push('clear');
    },
  };
  const store: ReturnType<typeof app.database.billingSynchronization> = {
    receipts: async () => ({ rows: [], afterId: null, exhausted: true }),
    customers: async () => ({
      rows: [{ customerId: claim.customerId }],
      afterId: null,
      exhausted: true,
    }),
    claim: async () => claim,
    receive: async () => 'recorded',
    retry: async () => {
      calls.push('retry');
      return true;
    },
    apply: async (claimed, evidence) => {
      calls.push(`apply:${claimed.priceId}:${evidence.settlement.kind}`);
      return 'applied';
    },
  };
  return {
    app: {
      ...app,
      config: { ...app.config, billing },
      database: {
        ...app.database,
        billingSubscriptionStaleness: () => ({
          sample: async () => ({
            sampledAt: '2026-11-06T12:00:00.000Z',
            throughId: null,
            afterId: null,
            exhausted: true,
            scanned: 0,
            pending: 0,
            claimed: 0,
            settled: 0,
            unconfirmed: 0,
            oldestRevisionRequestedAt: null,
            oldestObservedAt: null,
          }),
        }),
        billingSynchronization: (instanceId: string) => {
          calls.push(`service:${instanceId}`);
          return store;
        },
      },
    },
    store,
    calls,
    timers,
    tick: () => tick(),
    cadence: () => cadence,
  };
}

test('no-Stripe beta starts neither subscription timers nor transport', () => {
  const app = build(),
    calls: string[] = [];
  const result = startBillingSubscriptions({
    app,
    instanceId: createId(),
    timers: {
      setInterval: () => {
        calls.push('timer');
        return 1;
      },
      clearInterval: () => undefined,
    },
    fetch: Object.assign(
      async () => {
        calls.push('fetch');
        throw Error('Unexpected transport');
      },
      { preconnect() {} },
    ),
  });
  assert({
    given: 'supported beta config without Stripe keys',
    should: 'remain inert without fake vendor authority',
    actual: [result, calls],
    expected: [null, []],
  });
});

test('actual scheduled SDK reads use current-service original offer despite new-purchase price changes', async () => {
  const h = harness(),
    requests: string[] = [];
  const fetch: BillingFetch = Object.assign(
    async (input: Parameters<BillingFetch>[0]) => {
      const url = new URL(String(input));
      requests.push(url.pathname);
      return Response.json(
        url.pathname.includes('/subscriptions/')
          ? subscription
          : url.pathname === '/v1/invoices'
            ? { object: 'list', data: [invoice], has_more: false }
            : invoice,
      );
    },
    { preconnect() {} },
  );
  const service = startBillingSubscriptions({
    app: h.app,
    instanceId: 'current-service-fixture',
    timers: h.timers,
    fetch,
  })!;
  await service.started;
  await service.stop();
  await h.tick();
  assert({
    given:
      'a frozen priceA claim, actual pinned SDK responses and live new-purchase priceB',
    should:
      'apply priceA through current-service repair and stop all later work',
    actual: { calls: h.calls, requests, cadence: h.cadence() },
    expected: {
      calls: [
        'service:current-service-fixture',
        'apply:price_fixture:paid',
        'clear',
      ],
      requests: [
        '/v1/subscriptions/sub_fixture',
        '/v1/invoices/in_current',
        '/v1/invoices',
      ],
      cadence: 5000,
    },
  });
});

test('subscription shutdown waits for the bounded SDK read and never applies a retired process result', async () => {
  const h = harness(),
    entered = Promise.withResolvers<void>(),
    finish = Promise.withResolvers<void>();
  let requests = 0,
    stopped = false;
  const fetch: BillingFetch = Object.assign(
    async () => {
      requests += 1;
      entered.resolve();
      await finish.promise;
      return Response.json(subscription);
    },
    { preconnect() {} },
  );
  const service = startBillingSubscriptions({
    app: h.app,
    instanceId: 'current-service-fixture',
    timers: h.timers,
    fetch,
  })!;
  await entered.promise;
  const overlap = h.tick();
  const stopping = service.stop().then(() => {
    stopped = true;
  });
  const before = [requests, stopped];
  finish.resolve();
  await Promise.all([overlap, stopping]);
  await h.tick();
  assert({
    given: 'a tick and shutdown during the first vendor read',
    should:
      'admit no overlap, wait for completion and leave the durable claim for another instance',
    actual: [before, requests, stopped, h.calls],
    expected: [
      [1, false],
      1,
      true,
      ['service:current-service-fixture', 'clear'],
    ],
  });
});
