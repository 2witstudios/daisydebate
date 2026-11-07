import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fixedClock, sequentialId } from '@daisy/clock';
import { authTestEnv } from '../features/auth/auth-server.test-support';
import { betaMessagingPolicy } from '../features/messaging/beta-policy';
import { createBillingNativeResolver } from './billing-app';
import { createApp } from './app';

setupRitewayBun();

test('the process composition serves native disabled operations without Stripe or database I/O', async () => {
  let transportCalls = 0;
  const app = createApp({
    env: {
      ...authTestEnv,
      DATABASE_URL: 'postgres://unit:unit@localhost:5432/unit',
      REDIS_URL: 'redis://localhost:6379',
      REDIS_NAMESPACE: 'billing-process-unit',
      LOG_LEVEL: 'silent',
    },
    messagingPolicy: betaMessagingPolicy,
    clock: fixedClock('2026-11-06T00:00:00.000Z'),
    ids: sequentialId('billingprocess'),
    fetch: async () => {
      throw new Error('Unexpected mail');
    },
  });
  const resolve = createBillingNativeResolver();
  const transport = Object.assign(
    async () => {
      transportCalls += 1;
      throw new Error('Unexpected Stripe');
    },
    { preconnect() {} },
  );
  try {
    const first = resolve(app, transport);
    const subject = { userId: 'user', actorId: 'actor' };
    assert({
      given: 'a real process composition with no Stripe configuration',
      should:
        'compose once and refuse purchase and management without contacting a vendor',
      actual: {
        same: first === resolve(app, transport),
        checkout: await first.checkout(subject),
        portal: await first.portal(subject),
        transportCalls,
      },
      expected: {
        same: true,
        checkout: { kind: 'unavailable' },
        portal: { kind: 'unavailable' },
        transportCalls: 0,
      },
    });
  } finally {
    await app.close();
  }
});

test('actual native composition uses the injected public display reader afresh while management stays available', async () => {
  const now = '2026-11-06T00:00:00.000Z';
  const app = createApp({
    env: {
      ...authTestEnv,
      DATABASE_URL: 'postgres://unit:unit@localhost:5432/unit',
      REDIS_URL: 'redis://localhost:6379',
      REDIS_NAMESPACE: 'billing-display-unit',
      LOG_LEVEL: 'silent',
    },
    messagingPolicy: betaMessagingPolicy,
    clock: fixedClock(now),
    ids: sequentialId('billingdisplay'),
    fetch: async () => {
      throw Error('Unexpected outbound request');
    },
  });
  let state: 'enabled' | 'killed' | 'unavailable' = 'enabled';
  const reads: (string | null)[] = [];
  const subject = { userId: 'u'.repeat(24), actorId: 'a'.repeat(24) };
  const composed = {
    ...app,
    config: {
      ...app.config,
      billing: {
        kind: 'stripe' as const,
        mode: 'test' as const,
        secretKey: 'sk_test_fixture',
        webhookSecret: 'whsec_fixture',
        premiumPriceId: 'price_fixture',
        portalConfigurationId: 'bpc_fixture',
      },
    },
    database: {
      ...app.database,
      billingMember: () => ({
        read: async () => ({
          now,
          evidence: null,
          subscriptionLifecycle: null,
          hasCustomer: true,
          purchaseAllowed: true,
          botDebates: { kind: 'unavailable' as const },
        }),
        portalCustomer: async () => ({
          id: 'cus_original',
          mode: 'test' as const,
        }),
      }),
      readFlagSnapshot: async (accountId: string | null) => {
        reads.push(accountId);
        if (state === 'unavailable')
          throw Error('Controlled unavailable display read');
        return {
          snapshot: {
            kind: 'available' as const,
            flags: [
              { key: 'premium-checkout', revision: 1, state, override: null },
            ],
          },
          now: Date.parse(now),
        };
      },
    },
  };
  const transport = Object.assign(
    async () => {
      throw Error('Unexpected vendor request');
    },
    { preconnect() {} },
  );
  try {
    const runtime = createBillingNativeResolver()(composed, transport);
    const enabled = await runtime.settings(subject);
    state = 'killed';
    const killed = await runtime.settings(subject);
    state = 'unavailable';
    const unavailable = await runtime.settings(subject);
    assert({
      given:
        'the real native composition, published request reader and successive owned display snapshots',
      should:
        'read each display afresh without ambient Next request state and preserve management through kill/failure',
      actual: [
        reads,
        [
          enabled.checkoutAvailable,
          killed.checkoutAvailable,
          unavailable.checkoutAvailable,
        ],
        [
          enabled.manageAvailable,
          killed.manageAvailable,
          unavailable.manageAvailable,
        ],
      ],
      expected: [
        [subject.userId, subject.userId, subject.userId],
        [true, false, false],
        [true, true, true],
      ],
    });
  } finally {
    await app.close();
  }
});

test('the source Billing factory imports in a fresh Bun process before Next initializes', async () => {
  const child = Bun.spawn(
    [
      'bun',
      '--eval',
      `await import('./src/server/billing-app.ts');
       await import('next/dist/server/node-environment-baseline.js');
       const { workAsyncStorage } = await import('next/dist/server/app-render/work-async-storage.external.js');
       workAsyncStorage.run({}, () => {});`,
    ],
    {
      cwd: new URL('../..', import.meta.url).pathname,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const [exit, stderr] = await Promise.all([
    child.exited,
    new Response(child.stderr).text(),
  ]);
  assert({
    given:
      'the actual source factory in a fresh process without Next initialization',
    should:
      'leave Next request storage unpoisoned for its own subsequent initialization',
    actual: { exit, stderr },
    expected: { exit: 0, stderr: '' },
  });
});
