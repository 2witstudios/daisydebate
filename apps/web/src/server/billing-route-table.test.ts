import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppError } from '@daisy/errors';
import { fixedClock, sequentialId } from '@daisy/clock';
import { authTestEnv } from '../features/auth/auth-server.test-support';
import { betaMessagingPolicy } from '../features/messaging/beta-policy';
import { composeBillingRoutes } from '../features/billing/native-composition';
import { member, origin } from './member-boundary.test-support';
import { createApp } from './app';
import { createLazyBillingRoutes } from './billing-route-table';

setupRitewayBun();

const fixture = () =>
  createApp({
    env: {
      ...authTestEnv,
      DATABASE_URL: 'postgres://unit:unit@localhost:5432/unit',
      REDIS_URL: 'redis://localhost:6379',
      REDIS_NAMESPACE: 'billing-route-table-unit',
      LOG_LEVEL: 'silent',
    },
    messagingPolicy: betaMessagingPolicy,
    clock: fixedClock('2026-11-07T00:00:00.000Z'),
    ids: sequentialId('billingroutes'),
    fetch: async () => {
      throw Error('Unexpected mail');
    },
  });
const noVendor = Object.assign(
  async () => {
    throw Error('Unexpected vendor');
  },
  { preconnect() {} },
);
const request = () =>
  new Request(`${origin}/api/billing/checkout`, {
    method: 'POST',
    headers: { origin, 'content-type': 'application/x-www-form-urlencoded' },
    body: '',
  });

test('the process-owned lazy table retains its complete trusted boundary and rejects forged codes', async () => {
  const app = fixture();
  let loads = 0;
  let compositions = 0;
  let trusted = true;
  const routes = createLazyBillingRoutes(app, noVendor, async () => {
    loads += 1;
    return {
      billingRoutes: (ownedApp, ownedFetch) => {
        compositions += 1;
        if (ownedApp !== app || ownedFetch !== noVendor)
          throw Error('Wrong process');
        return composeBillingRoutes({
          boundary: {
            logger: app.logger,
            reporter: app.reporter,
            origin: () => origin,
            identify: async () => member,
            limiter: () => ({
              consume: async () => ({ allowed: true, retryAfterSeconds: 1 }),
            }),
          },
          runtime: () => ({
            checkout: async () => {
              throw trusted
                ? createAppError('NOT_FOUND')
                : { code: 'NOT_FOUND' };
            },
            portal: async () => ({ kind: 'unavailable' }),
            settings: async () => {
              throw Error('Unused settings');
            },
          }),
        });
      },
    };
  });
  try {
    const before = loads;
    const refused = await routes.checkout.POST(request());
    trusted = false;
    const forged = await routes.checkout.POST(request());
    const portal = await routes.portal.POST(request());
    assert({
      given:
        'one process-owned App/transport and a lazily loaded complete Billing boundary',
      should:
        'load once on first Billing use, preserve minted 404, reject a forged code and share the cached table',
      actual: [
        before,
        loads,
        compositions,
        refused.status,
        forged.status,
        portal.status,
        (await refused.json()).error.code,
        (await forged.json()).error.code,
      ],
      expected: [0, 1, 1, 404, 500, 303, 'NOT_FOUND', 'INTERNAL'],
    });
  } finally {
    await app.close();
  }
});

test('lazy Billing loader failures use the process public error boundary', async () => {
  const app = fixture();
  const routes = createLazyBillingRoutes(app, noVendor, async () => {
    throw Object.assign(Error('private configuration'), { code: 'NOT_FOUND' });
  });
  try {
    const response = await routes.settings.GET(
      new Request(`${origin}/api/billing/settings`),
    );
    const body = await response.text();
    assert({
      given: 'a failed lazy module load with an unminted code-shaped error',
      should:
        'return correlated no-store INTERNAL without configuration details',
      actual: [
        response.status,
        JSON.parse(body).error.code,
        Boolean(response.headers.get('x-request-id')),
        response.headers.get('cache-control'),
        body.includes('private configuration'),
      ],
      expected: [500, 'INTERNAL', true, 'no-store', false],
    });
  } finally {
    await app.close();
  }
});
