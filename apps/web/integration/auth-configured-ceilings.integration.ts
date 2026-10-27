import { afterAll } from 'bun:test';
import { requireTestServices } from '@daisy/config';
import { createRedis } from '@daisy/redis';
import { createBoundedTestClient } from '@daisy/redis/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createSignUpCeiling } from '../src/features/auth/abuse/rate-limit';
import { createAuthRateLimiter } from '../src/features/auth/abuse/redis-limiter';
import { createAccountFlows } from './auth-account-helpers';
import { createSecondInstances, elapse } from './auth-rate-limit-helpers';
import { createTestApp, testRedisUrl } from './fixtures';

requireTestServices(process.env);
setupRitewayBun();
const minuteApp = createTestApp({
  AUTH_SIGN_UP_MAIL_CEILINGS: '{"perMinute":2,"perDay":10}',
});
const { secondInstance, closeExtraInstances } =
  createSecondInstances(minuteApp);
afterAll(closeExtraInstances);

const dayApp = createTestApp({
  AUTH_SIGN_UP_MAIL_CEILINGS: '{"perMinute":20,"perDay":2}',
});
const otherRedis = createRedis({
  url: testRedisUrl,
  namespace: dayApp.redisNamespace,
  client: createBoundedTestClient(testRedisUrl),
});
afterAll(() => otherRedis.close());

test('configured ceilings share real counters across instances without changing address-neutral answers', async () => {
  const { email: existing } = await createAccountFlows(minuteApp).signUp();
  await elapse(minuteApp, 'auth:magic-link:global:60');
  const other = secondInstance();
  const before = minuteApp.mailbox.mails.length;
  const post = (
    handler: (request: Request) => Promise<Response>,
    email: string,
  ) => handler(minuteApp.jsonPost('/api/auth/sign-in/magic-link', { email }));
  const admitted = await Promise.all([
    post(minuteApp.routes.auth.POST, minuteApp.freshEmail()),
    post(other.handlers.POST, minuteApp.freshEmail()),
  ]);
  const unknown = await post(other.handlers.POST, minuteApp.freshEmail());
  const known = await post(minuteApp.routes.auth.POST, existing);
  await minuteApp.app.auth().settled();
  assert({
    given:
      'two app instances sharing an explicit two-send minute budget, then new and existing addresses past it',
    should:
      'send exactly two new-address mails, keep sign-in available and return the same public success for every request',
    actual: {
      statuses: [...admitted, unknown, known].map(
        (response) => response.status,
      ),
      neutral: (await unknown.text()) === (await known.text()),
      mails: minuteApp.mailbox.mails.length - before + other.sent.length,
      signIn: minuteApp.mailbox.mails.at(-1)?.to === existing,
    },
    expected: {
      statuses: [200, 200, 200, 200],
      neutral: true,
      mails: 3,
      signIn: true,
    },
  });
});

test('configured UTC-day ceiling is atomic across real Redis clients and resets without sleep', async () => {
  let now = '2026-10-26T23:59:59.000Z';
  const dependencies = {
    clock: { now: () => now },
    logger: dayApp.app.logger,
    ceilings: dayApp.app.auth().config.AUTH_SIGN_UP_MAIL_CEILINGS,
  };
  const first = createSignUpCeiling({
    ...dependencies,
    limiter: dayApp.app.auth().limiter,
  });
  const second = createSignUpCeiling({
    ...dependencies,
    limiter: createAuthRateLimiter(otherRedis),
  });
  const sameDay = await Promise.all([first(), second()]);
  const excess = await first();
  now = '2026-10-27T00:00:00.000Z';
  assert({
    given:
      'two independent Redis clients consuming the same two-send UTC-day budget',
    should:
      'admit the exact limit, refuse excess and reopen on the next injected UTC date',
    actual: [sameDay, excess, await second()],
    expected: [[true, true], false, true],
  });
});
