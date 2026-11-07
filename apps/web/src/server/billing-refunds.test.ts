import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fixedClock } from '@daisy/clock';
import { advanceRefund, type RefundAction } from '@daisy/protocol/billing';
import { createApp } from './app';
import { startBillingRefunds } from './billing-refunds';
import { authTestEnv } from '../features/auth/auth-server.test-support';
import { betaMessagingPolicy } from '../features/messaging/beta-policy';
import { refundFixture } from '../features/billing/refund.test-support';
import type { BillingFetch } from './billing-stripe';

setupRitewayBun();
const fixture = refundFixture();
function harness(mode: 'test' | 'live' = 'test') {
  const app = createApp({
    env: {
      ...authTestEnv,
      DATABASE_URL: 'postgres://unit:unit@localhost:5432/unit',
      REDIS_URL: 'redis://localhost:6379',
      REDIS_NAMESPACE: 'billing-refund-unit',
      LOG_LEVEL: 'silent',
    },
    messagingPolicy: betaMessagingPolicy,
    clock: fixedClock(fixture.now),
    ids: { next: () => fixture.base.id },
    fetch: async () => {
      throw Error('Unexpected network');
    },
  });
  const known: RefundAction = {
    ...fixture.base,
    mode,
    state: {
      kind: 'known',
      startedAt: fixture.now,
      refundId: fixture.refund.id,
      status: 'succeeded',
      observedAt: fixture.now,
    },
  };
  const transition = advanceRefund(
    known,
    { kind: 'claim', claimId: fixture.claimId },
    { now: fixture.now, authority: 'closed' },
  );
  if (transition.kind !== 'changed')
    throw Error('Controlled original-action claim refused');
  const calls: unknown[] = [],
    records: unknown[] = [];
  let tick: () => Promise<void> = async () => undefined;
  const store: ReturnType<typeof app.database.billingRefunds> = {
    admit: async () => {
      throw Error('Scheduled repair must not admit new refund obligations');
    },
    actions: async (input) => {
      calls.push(['actions', input]);
      return { rows: [{ actionId: known.id }], afterId: null, exhausted: true };
    },
    claim: async (id) => {
      calls.push(['claim', id]);
      return { action: transition.action, work: 'retrieve' };
    },
    record: async (id, event) => {
      records.push([id, event]);
      return 'changed';
    },
  };
  return {
    app: {
      ...app,
      config: {
        ...app.config,
        billing: {
          kind: 'stripe' as const,
          mode: 'test' as const,
          secretKey: 'sk_test_fixture',
          webhookSecret: 'whsec_fixture',
          premiumPriceId: 'price_replacement',
          portalConfigurationId: 'bpc_fixture',
        },
      },
      database: {
        ...app.database,
        billingRefunds: (instanceId: string) => {
          calls.push(['service', instanceId]);
          return store;
        },
      },
    },
    calls,
    records,
    timers: {
      setInterval: (run: () => Promise<void>, ms: number) => {
        tick = run;
        calls.push(['cadence', ms]);
        return 1;
      },
      clearInterval: () => {
        calls.push(['clear']);
      },
    },
    tick: () => tick(),
  };
}

test('runtime independently refetches the original refund after success without customer or privacy-job discovery', async () => {
  const h = harness(),
    requests: unknown[] = [];
  const fetch: BillingFetch = Object.assign(
    async (
      input: Parameters<BillingFetch>[0],
      init?: Parameters<BillingFetch>[1],
    ) => {
      requests.push([new URL(String(input)).pathname, init?.method ?? 'GET']);
      return Response.json({ ...fixture.refund, status: 'failed' });
    },
    { preconnect() {} },
  );
  const service = startBillingRefunds({
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
      'an original known-success refund and a later failed vendor observation, with no customer/job port in the worker',
    should:
      'record against the same action/claim using only independent current-service action discovery and the original refund GET',
    actual: [h.calls, requests, h.records],
    expected: [
      [
        ['service', 'current-service-fixture'],
        ['cadence', 5000],
        ['actions', { mode: 'test', limit: 3 }],
        ['claim', fixture.base.id],
        ['clear'],
      ],
      [[`/v1/refunds/${fixture.refund.id}`, 'GET']],
      [
        [
          fixture.base.id,
          {
            kind: 'observe',
            claimId: fixture.claimId,
            refundId: fixture.refund.id,
            status: 'failed',
          },
        ],
      ],
    ],
  });
});

test('refund drain preserves the in-flight financial observation but admits no next tick', async () => {
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
      return Response.json({ ...fixture.refund, status: 'requires_action' });
    },
    { preconnect() {} },
  );
  const service = startBillingRefunds({
    app: h.app,
    instanceId: 'current-service-fixture',
    timers: h.timers,
    fetch,
  })!;
  await entered.promise;
  const stopping = service.stop().then(() => {
    stopped = true;
  });
  const before = stopped;
  finish.resolve();
  await stopping;
  await h.tick();
  assert({
    given: 'shutdown during an original refund read',
    should:
      'await and retain the exact financial fact under its claim, then stop without replacing the action',
    actual: [before, stopped, requests, h.records],
    expected: [
      false,
      true,
      1,
      [
        [
          fixture.base.id,
          {
            kind: 'observe',
            claimId: fixture.claimId,
            refundId: fixture.refund.id,
            status: 'requires_action',
          },
        ],
      ],
    ],
  });
});

test('independent refund repair refuses a foreign configured mode before transport', async () => {
  const h = harness('live');
  let requests = 0;
  const fetch: BillingFetch = Object.assign(
    async () => {
      requests += 1;
      throw Error('Unexpected transport');
    },
    { preconnect() {} },
  );
  const service = startBillingRefunds({
    app: h.app,
    instanceId: 'current-service-fixture',
    timers: h.timers,
    fetch,
  })!;
  await service.started;
  await service.stop();
  assert({
    given: 'a live action discovered by a TEST client',
    should:
      'leave money authority untouched without any vendor request or fabricated result',
    actual: [requests, h.records],
    expected: [0, []],
  });
});
