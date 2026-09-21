import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { systemClock, systemId } from '@daisy/clock';
import { createDatabase } from '@daisy/db';
import { createRedis } from '@daisy/redis';
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
  testDatabaseUrl,
  testRedisUrl,
} from './auth-mounted-helpers';
import {
  CLIENT_IP_HEADER,
  stampClientIdentity,
} from '../src/features/auth/client-ip';
import { createAuthRouteHandlers } from '../src/features/auth/handlers';
import { createAuthRateLimiter } from '../src/features/auth/rate-limit';
import { createAuthServer } from '../src/features/auth/server';

setupRitewayBun();
configureAppEnvironment();

const mailbox = installMailbox();
const authRoute = await import('../src/app/api/auth/[...all]/route');
const { getResources } = await import('../src/server/resources');

const silentLogger = { log: () => {}, child: () => silentLogger };
const noLedger = { isSuppressed: async () => false, record: async () => {} };
const authEnv = { ...process.env } as Record<string, string | undefined>;
const magicLink = (
  headers: Record<string, string> = {},
  email = fixtureEmail(),
) =>
  authRoute.POST(jsonPost('/api/auth/sign-in/magic-link', { email }, headers));
const statuses = (responses: Response[]) =>
  responses.reduce<Record<number, number>>((tally, response) => {
    tally[response.status] = (tally[response.status] ?? 0) + 1;
    return tally;
  }, {});

const extraInstances: Array<() => Promise<void>> = [];
/** A second application instance: its own SQL pool, Redis connection and auth. */
function secondInstance(
  overrides: {
    redisUrl?: string;
    limiter?: (
      base: ReturnType<typeof createAuthRateLimiter>,
    ) => Parameters<typeof createAuthServer>[0]['limiter'];
  } = {},
) {
  const database = createDatabase({ url: testDatabaseUrl as string });
  const redis = createRedis({
    url: overrides.redisUrl ?? (testRedisUrl as string),
    namespace: redisNamespace,
  });
  const base = createAuthRateLimiter(redis);
  const sent: string[] = [];
  const server = createAuthServer({
    env: authEnv,
    database: database.authAdapter,
    emailSender: {
      send: async (message) => {
        sent.push(message.to);
      },
    },
    limiter: overrides.limiter ? overrides.limiter(base) : base,
    ledger: noLedger,
    logger: silentLogger,
    clock: systemClock,
    ids: systemId,
  });
  extraInstances.push(async () => {
    await database.close();
    redis.close();
  });
  return {
    sent,
    handlers: createAuthRouteHandlers(() => ({
      handler: server.instance.handler,
      config: server.config,
    })),
  };
}

afterAll(async () => {
  mailbox.restore();
  for (const close of extraInstances) await close();
  await clearRedisNamespace();
  await getResources().database.close();
  getResources().redis.close();
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
          return (
            seconds >= 1 &&
            seconds <= 60 &&
            response.headers.get('x-retry-after') !== null
          );
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
        'match the namespaced digest shape, carry no identifier and have a TTL of at most 60 seconds',
      actual: {
        any: keys.length > 0,
        allMatch: keys.every(({ key }) => pattern.test(key)),
        leaksIdentifier: keys.some(({ key }) =>
          /198\.51|example\.test|sign-in|magic-link|session/.test(key),
        ),
        allExpire: keys.every(({ ttlMs }) => ttlMs > 0 && ttlMs <= 60_000),
      },
      expected: {
        any: true,
        allMatch: true,
        leaksIdentifier: false,
        allExpire: true,
      },
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
        code: (JSON.parse(body) as { error: { code: string } }).error.code,
        leaks: ['127.0.0.1', 'redis', 'ECONNREFUSED', 'stack'].filter(
          (needle) => body.toLowerCase().includes(needle.toLowerCase()),
        ),
        delivered: dead.sent.length,
      },
      expected: {
        tally: { 503: 48 },
        retryAfter: '5',
        code: 'INFRASTRUCTURE',
        leaks: [],
        delivered: 0,
      },
    });
  });

  test('a limiter failure inside the recipient gate also fails closed', async () => {
    const flaky = secondInstance({
      limiter: (base) => ({
        consume: (key, rule) =>
          key.startsWith('magic-link-recipient|')
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
        code: ((await response.json()) as { code?: string }).code,
        retryAfter: response.headers.get('retry-after'),
        delivered: flaky.sent.length,
      },
      expected: {
        status: 503,
        code: 'AUTH_TEMPORARILY_UNAVAILABLE',
        retryAfter: '5',
        delivered: 0,
      },
    });
  });
});

/** Stand-in for the deployment ingress: the same stamping start.ts performs. */
async function ingress(trustedProxies: string[]) {
  const toRequest = async (incoming: IncomingMessage) => {
    stampClientIdentity(incoming, trustedProxies);
    const chunks: Buffer[] = [];
    for await (const chunk of incoming) chunks.push(chunk as Buffer);
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers))
      if (typeof value === 'string') headers.set(name, value);
    return new Request(`${origin}${incoming.url}`, {
      method: incoming.method ?? 'POST',
      headers,
      ...(incoming.method === 'POST' ? { body: Buffer.concat(chunks) } : {}),
    });
  };
  const server = createServer((incoming, outgoing) => {
    void toRequest(incoming)
      .then((request) => authRoute.POST(request))
      .then(async (response) => {
        outgoing.writeHead(response.status);
        outgoing.end(await response.text());
      });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    post: (headers: Record<string, string>) =>
      fetch(`http://127.0.0.1:${port}/api/auth/sign-in/magic-link`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin, ...headers },
        body: JSON.stringify({ email: fixtureEmail() }),
      }),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

describe('AUTH-3.4 trusted ingress identity', () => {
  test('forged forwarding and identity headers cannot evade the limit or reset the counter', async () => {
    const edge = await ingress([]);
    try {
      const responses: Response[] = [];
      for (let index = 0; index < 8; index += 1)
        responses.push(
          await edge.post({
            'x-forwarded-for': `203.0.113.${index + 1}, 198.51.100.${index + 9}`,
            'x-real-ip': `203.0.113.${index + 50}`,
            [CLIENT_IP_HEADER]: `192.0.2.${index + 1}`,
          }),
        );
      assert({
        given:
          'eight requests from one socket peer, each forging a different X-Forwarded-For and identity header',
        should: 'still be limited as one client: 3 admitted, 5 rejected',
        actual: responses.map((response) => response.status),
        expected: [200, 200, 200, 429, 429, 429, 429, 429],
      });
    } finally {
      await edge.close();
    }
  });

  test('behind a configured trusted proxy the real client is read from the right of the chain', async () => {
    const edge = await ingress(['127.0.0.1/32', '::1/128']);
    try {
      const realA = '198.51.100.201';
      const realB = '198.51.100.202';
      const viaA = [];
      for (let index = 0; index < 5; index += 1)
        viaA.push(
          await edge.post({
            // The left-most entry is caller-controlled; only the hop appended
            // by the trusted proxy (right-most) identifies the client.
            'x-forwarded-for': `203.0.113.${index + 1}, ${realA}`,
          }),
        );
      const viaB = await edge.post({
        'x-forwarded-for': `203.0.113.1, ${realB}`,
      });
      assert({
        given:
          'a trusted proxy forwarding two real clients while a caller prepends spoofed addresses',
        should:
          'limit each real client independently and ignore the spoofed entries',
        actual: {
          clientA: viaA.map((response) => response.status),
          clientB: viaB.status,
        },
        expected: { clientA: [200, 200, 200, 429, 429], clientB: 200 },
      });
    } finally {
      await edge.close();
    }
  });
});
