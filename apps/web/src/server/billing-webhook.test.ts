import Stripe from 'stripe';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fixedClock, sequentialId } from '@daisy/clock';
import { authTestEnv } from '../features/auth/auth-server.test-support';
import { betaMessagingPolicy } from '../features/messaging/beta-policy';
import { createApp } from './app';
import { composeBillingWebhook } from './billing-webhook';
import {
  createRecordingLogger,
  silentLogger,
} from './test-loggers.test-support';

setupRitewayBun();
const now = 1_790_000_000_000;
const webhookSecret = 'whsec_process_fixture';
const build = () =>
  createApp({
    env: {
      ...authTestEnv,
      DATABASE_URL: 'postgres://unit:unit@localhost:5432/unit',
      REDIS_URL: 'redis://localhost:6379',
      REDIS_NAMESPACE: 'billing-webhook-unit',
      LOG_LEVEL: 'silent',
      STRIPE_SECRET_KEY: 'sk_test_fixture',
      STRIPE_WEBHOOK_SECRET: webhookSecret,
      STRIPE_PREMIUM_PRICE_ID: 'price_fixture',
      STRIPE_PORTAL_CONFIGURATION_ID: 'bpc_fixture',
    },
    messagingPolicy: betaMessagingPolicy,
    clock: fixedClock(new Date(now).toISOString()),
    ids: sequentialId('webhook'),
    fetch: async () => {
      throw new Error('Unexpected network');
    },
  });
async function request() {
  const body = JSON.stringify({
    id: 'evt_fixture',
    object: 'event',
    type: 'invoice.paid',
    livemode: false,
    data: { object: { customer: 'cus_fixture' } },
  });
  return new Request('https://daisy.invalid/api/webhooks/stripe', {
    method: 'POST',
    body,
    headers: {
      'stripe-signature': await Stripe.webhooks.generateTestHeaderStringAsync({
        payload: body,
        secret: webhookSecret,
        timestamp: now / 1000,
      }),
    },
  });
}

test('the process webhook reports persistence failure without forwarding vendor/account facts', async () => {
  const app = build(),
    logs = createRecordingLogger(),
    reports: unknown[] = [];
  try {
    const handler = composeBillingWebhook({
      ...app,
      logger: logs.logger,
      reporter: {
        capture: (error, context) =>
          reports.push({
            message: error instanceof Error ? error.message : 'non-error',
            context,
          }),
      },
      database: {
        ...app.database,
        receiveBillingReceipt: async () => {
          throw new Error('cus_fixture private original exception');
        },
      },
    });
    const response = await handler(await request());
    assert({
      given:
        'a genuinely SDK-signed hint whose controlled durable writer fails',
      should:
        'request vendor retry and emit only the fixed scrubbed infrastructure signal',
      actual: {
        status: response.status,
        retry: response.headers.get('retry-after'),
        events: logs.recorded.map((entry) => entry.event),
        reports: reports.length,
        leaked: JSON.stringify([logs.recorded, reports]).includes(
          'cus_fixture',
        ),
      },
      expected: {
        status: 503,
        retry: '5',
        events: ['billing.webhook.failed'],
        reports: 1,
        leaked: false,
      },
    });
  } finally {
    await app.close();
  }
});

test('failing diagnostic sinks cannot replace the durable-retry response', async () => {
  const app = build();
  let reports = 0;
  try {
    const handler = composeBillingWebhook({
      ...app,
      logger: {
        ...silentLogger,
        log: () => {
          throw new Error('Controlled log failure');
        },
      },
      reporter: {
        capture: () => {
          reports += 1;
          throw new Error('Controlled reporter failure');
        },
      },
      database: {
        ...app.database,
        receiveBillingReceipt: async () => {
          throw new Error('Controlled DB failure');
        },
      },
    });
    const response = await handler(await request());
    assert({
      given: 'both diagnostic sinks fail after receipt persistence fails',
      should:
        'attempt both independently and still return retry rather than acknowledge the missing receipt',
      actual: [response.status, response.headers.get('retry-after'), reports],
      expected: [503, '5', 1],
    });
  } finally {
    await app.close();
  }
});
