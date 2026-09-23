import { afterAll } from 'bun:test';
import { createHash } from 'node:crypto';
import { RedisClient } from 'bun';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  clearRedisNamespace,
  configureAppEnvironment,
  fixtureEmail,
  installMailbox,
  jsonPost,
  newClient,
  origin,
  redisKeys,
  redisNamespace,
  testRedisUrl,
} from './auth-mounted-helpers';
import {
  closeExtraInstances,
  secondInstance,
  statuses,
} from './auth-rate-limit-helpers';
import { CLIENT_IP_HEADER } from '../src/features/auth/client-ip';

// Earlier tests in this file each pass a few requests through the real,
// shared global magic-link buckets before their own client or recipient
// bucket denies the rest — realistic, since the counter genuinely is shared
// application-wide. Clearing exactly these two keys (the same sha3-256
// digest `createAuthRateLimiter` sends to Redis) before the global-ceiling
// test below isolates it from that leftover, without touching any other
// test's already-asserted key.
async function clearGlobalMagicLinkBuckets() {
  const client = new RedisClient(testRedisUrl as string);
  try {
    for (const logicalKey of [
      'auth:magic-link:global:60',
      'auth:magic-link:global:86400',
    ])
      await client.del(
        `${redisNamespace}:v1:rl:${createHash('sha3-256').update(logicalKey).digest('hex')}`,
      );
  } finally {
    client.close();
  }
}

if (!process.env.TEST_DATABASE_URL || !process.env.TEST_REDIS_URL)
  throw new Error('TEST_DATABASE_URL and TEST_REDIS_URL are required');
setupRitewayBun();
configureAppEnvironment();

const mailbox = installMailbox();
const authRoute = await import('../src/app/api/auth/[...all]/route');

const magicLink = (
  headers: Record<string, string> = {},
  email = fixtureEmail(),
) =>
  authRoute.POST(jsonPost('/api/auth/sign-in/magic-link', { email }, headers));

afterAll(async () => {
  await closeExtraInstances();
  await clearRedisNamespace();
});

describe('AUTH-3.4 shared atomic rate limits through the mounted handler', () => {
  test('magic-link requests are limited to 3 per 60 seconds per client under concurrency', async () => {
    const client = newClient();
    const before = mailbox.mails.length;
    const responses = await Promise.all(
      Array.from({ length: 30 }, () =>
        magicLink({ [CLIENT_IP_HEADER]: client }),
      ),
    );
    const denied = responses.filter((response) => response.status === 429);
    assert({
      given: 'thirty simultaneous magic-link requests from one client',
      should:
        'admit exactly three, send exactly three messages and answer the rest 429 with retry information',
      actual: {
        tally: statuses(responses),
        mails: mailbox.mails.length - before,
        retryInfo: denied.every((response) => {
          const seconds = Number(response.headers.get('retry-after'));
          return seconds >= 1 && seconds <= 60;
        }),
      },
      expected: { tally: { 200: 3, 429: 27 }, mails: 3, retryInfo: true },
    });
  });

  test('one recipient is limited to 3 per 60 seconds even across many clients', async () => {
    const email = fixtureEmail();
    const before = mailbox.mails.length;
    const responses = await Promise.all(
      Array.from({ length: 12 }, () =>
        magicLink({ [CLIENT_IP_HEADER]: newClient() }, email),
      ),
    );
    const denied = responses.find((response) => response.status === 429);
    assert({
      given: 'twelve simultaneous requests for one address from twelve clients',
      should: 'admit exactly three and answer the rest 429 with a Retry-After',
      actual: {
        tally: statuses(responses),
        mails: mailbox.mails.length - before,
        retryAfter: Number(denied?.headers.get('retry-after')) >= 1,
      },
      expected: { tally: { 200: 3, 429: 9 }, mails: 3, retryAfter: true },
    });
  });

  test('all other auth routes share the 100 per 60 seconds default', async () => {
    const client = newClient();
    const responses = await Promise.all(
      Array.from({ length: 130 }, () =>
        authRoute.GET(
          new Request(`${origin}/api/auth/get-session`, {
            headers: { [CLIENT_IP_HEADER]: client },
          }),
        ),
      ),
    );
    assert({
      given: 'one hundred thirty simultaneous session reads from one client',
      should: 'admit exactly 100 and reject 30 with 429',
      actual: statuses(responses),
      expected: { 200: 100, 429: 30 },
    });
  });

  test('two application instances share one atomic counter', async () => {
    const a = secondInstance();
    const b = secondInstance();
    const client = newClient();
    const send = (instance: typeof a) =>
      instance.handlers.POST(
        jsonPost(
          '/api/auth/sign-in/magic-link',
          { email: fixtureEmail() },
          { [CLIENT_IP_HEADER]: client },
        ),
      );
    const responses = await Promise.all(
      Array.from({ length: 40 }, (_, index) => send(index % 2 === 0 ? a : b)),
    );
    assert({
      given:
        'forty simultaneous requests split across two instances for one client',
      should:
        'admit exactly three in total (not three per instance) and deliver exactly three',
      actual: {
        tally: statuses(responses),
        delivered: a.sent.length + b.sent.length,
      },
      expected: { tally: { 200: 3, 429: 37 }, delivered: 3 },
    });
  });

  test('keys are hashed, namespaced and always expiring', async () => {
    const keys = await redisKeys();
    const pattern = new RegExp(`^${redisNamespace}:v1:rl:[0-9a-f]{64}$`);
    assert({
      given: 'every rate-limit key written by the runs above',
      should:
        // The recipient and global tables above include 60 s, 1 h and 1 day
        // windows; a day is the longest TTL any bucket can carry.
        'match the namespaced digest shape, carry no identifier and have a TTL of at most one day',
      actual: {
        any: keys.length > 0,
        allMatch: keys.every(({ key }) => pattern.test(key)),
        leaksIdentifier: keys.some(({ key }) =>
          /198\.51|example\.test|sign-in|magic-link|session/.test(key),
        ),
        allExpire: keys.every(
          ({ ttlMs }) => ttlMs > 0 && ttlMs <= 86_400_000,
        ),
      },
      expected: {
        any: true,
        allMatch: true,
        leaksIdentifier: false,
        allExpire: true,
      },
    });
  });

  test('one recipient across many clients exceeds the hour ceiling once the minute window is out of the way', async () => {
    // The minute window (3/60s) is the binding constraint for any burst
    // within the same instant, so it must be exhausted and moved past
    // before the hour ceiling (10/h) can be the one that denies. A fake
    // sub-limiter lets the minute bucket's real Redis verdict decide as
    // usual while pinning only the hour bucket's decision, so the gate's
    // handling of a real recipient-hour denial is proven end to end without
    // requiring an hour of real wall-clock time between requests.
    const email = fixtureEmail();
    let hourDenials = 0;
    const server = secondInstance({
      limiter: (base) => ({
        consume: (key, rule) => {
          const isRecipientBucket = key.startsWith(
            'auth:magic-link:recipient:',
          );
          // Bypass the real minute recipient window so the burst can reach
          // the hour bucket without the (already separately proven) minute
          // ceiling denying first; the client, day and global buckets stay
          // real, since only ten single-client, single-recipient requests
          // never come close to their real thresholds.
          if (isRecipientBucket && rule.windowSeconds === 60)
            return Promise.resolve({ allowed: true, retryAfterSeconds: 0 });
          if (isRecipientBucket && rule.windowSeconds === 3_600) {
            hourDenials += 1;
            return Promise.resolve({
              allowed: hourDenials <= 10,
              retryAfterSeconds: 3_600,
            });
          }
          return base.consume(key, rule);
        },
      }),
    });
    const responses: Response[] = [];
    for (let index = 0; index < 11; index += 1)
      responses.push(
        await server.handlers.POST(
          jsonPost(
            '/api/auth/sign-in/magic-link',
            { email },
            { [CLIENT_IP_HEADER]: newClient() },
          ),
        ),
      );
    assert({
      given:
        'eleven sequential requests for one recipient, each from a distinct client, with the hour bucket pinned to allow exactly ten',
      should: 'admit the first ten and deny the eleventh once the hour ceiling is reached',
      actual: statuses(responses),
      expected: { 200: 10, 429: 1 },
    });
  });

  test('the global per-minute ceiling denies once 120 distinct recipients have sent this minute', async () => {
    await clearGlobalMagicLinkBuckets();
    const responses = await Promise.all(
      Array.from({ length: 121 }, () =>
        magicLink({ [CLIENT_IP_HEADER]: newClient() }, fixtureEmail()),
      ),
    );
    assert({
      given:
        '121 simultaneous magic-link requests, each its own client and recipient',
      should:
        'admit exactly 120 (the global per-minute ceiling) and deny the rest, independent of any single client or recipient bucket',
      actual: statuses(responses),
      expected: { 200: 120, 429: 1 },
    });
  });
});

describe('AUTH-3.4 outage fails closed', () => {
  test('a Redis outage answers a safe 503 for every request and never counts locally', async () => {
    const dead = secondInstance({ redisUrl: 'redis://127.0.0.1:1' });
    const client = newClient();
    const responses: Response[] = [];
    // Sequential and parallel: a process-local fallback counter would start
    // rejecting with 429 (or admitting) after a few requests.
    for (let index = 0; index < 8; index += 1)
      responses.push(
        await dead.handlers.POST(
          jsonPost(
            '/api/auth/sign-in/magic-link',
            { email: fixtureEmail() },
            { [CLIENT_IP_HEADER]: client },
          ),
        ),
      );
    responses.push(
      ...(await Promise.all(
        Array.from({ length: 40 }, () =>
          dead.handlers.POST(
            jsonPost(
              '/api/auth/sign-in/magic-link',
              { email: fixtureEmail() },
              { [CLIENT_IP_HEADER]: client },
            ),
          ),
        ),
      )),
    );
    const sample = responses[0];
    const body = JSON.stringify(await sample?.clone().json());
    assert({
      given: 'an unreachable Redis and 48 requests from one client',
      should:
        'return 503 for all, with Retry-After and a fixed public body, and deliver nothing',
      actual: {
        tally: statuses(responses),
        retryAfter: sample?.headers.get('retry-after'),
        message: (JSON.parse(body) as { message: string }).message,
        leaks: ['127.0.0.1', 'redis', 'ECONNREFUSED', 'stack'].filter(
          (needle) => body.toLowerCase().includes(needle.toLowerCase()),
        ),
        delivered: dead.sent.length,
      },
      expected: {
        tally: { 503: 48 },
        retryAfter: '5',
        message: 'Service temporarily unavailable',
        leaks: [],
        delivered: 0,
      },
    });
  });

  test('a limiter failure inside the recipient gate also fails closed', async () => {
    const flaky = secondInstance({
      limiter: (base) => ({
        consume: (key, rule) =>
          key.startsWith('auth:magic-link:recipient:')
            ? Promise.reject(new Error('redis down'))
            : base.consume(key, rule),
      }),
    });
    const response = await flaky.handlers.POST(
      jsonPost('/api/auth/sign-in/magic-link', { email: fixtureEmail() }),
    );
    assert({
      given: 'the recipient counter becoming unavailable mid-request',
      should: 'answer 503 with a retryable code and send no mail',
      actual: {
        status: response.status,
        message: ((await response.json()) as { message?: string }).message,
        retryAfter: response.headers.get('retry-after'),
        delivered: flaky.sent.length,
      },
      expected: {
        status: 503,
        message: 'Service temporarily unavailable',
        retryAfter: '5',
        delivered: 0,
      },
    });
  });
});
