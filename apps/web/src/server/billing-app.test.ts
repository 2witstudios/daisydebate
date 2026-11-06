import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fixedClock, sequentialId } from '@daisy/clock';
import { authTestEnv } from '../features/auth/auth-server.test-support';
import { betaMessagingPolicy } from '../features/messaging/beta-policy';
import { createBillingApp } from './billing-app';

setupRitewayBun();

test('the process composition serves native disabled operations without Stripe or database I/O', async () => {
  let transportCalls = 0;
  const app = createBillingApp(
    {
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
    },
    Object.assign(
      async () => {
        transportCalls += 1;
        throw new Error('Unexpected Stripe');
      },
      { preconnect() {} },
    ),
  );
  try {
    const first = app.billingNative();
    const subject = { userId: 'user', actorId: 'actor' };
    assert({
      given: 'a real process composition with no Stripe configuration',
      should:
        'compose once and refuse purchase and management without contacting a vendor',
      actual: {
        same: first === app.billingNative(),
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
