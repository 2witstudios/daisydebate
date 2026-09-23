import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { memoryAdapter } from '@better-auth/memory-adapter';
import { fixedClock, sequentialId } from '@daisy/clock';
import { readAuthConfig } from '@daisy/config';
import type { Logger } from '@daisy/logger';
import type { AuthRateLimiter } from './rate-limit';
import { CLIENT_IP_HEADER } from './client-ip';
import { createAuthServer } from './server';

setupRitewayBun();

const env = {
  NODE_ENV: 'test',
  BETTER_AUTH_SECRET:
    '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  PUBLIC_APP_URL: 'http://localhost:3000',
  RESEND_API_KEY: 're_test_000000000000000000000000',
  AUTH_EMAIL_FROM: 'Daisy <no-reply@daisy.example.com>',
};
const email = 'player@daisy.example.com';
const silentLogger: Logger = { log: () => {}, child: () => silentLogger };
type Decision = Awaited<ReturnType<AuthRateLimiter['consume']>>;
const allow: Decision = { allowed: true, retryAfterSeconds: 0 };

const compose = (options: { decide?: (key: string) => Decision }) => {
  const keys: string[] = [];
  const sent: string[] = [];
  const tables = {
    user: [],
    session: [],
    account: [],
    verification: [] as unknown[],
    passkey: [],
  };
  const server = createAuthServer({
    config: readAuthConfig(env),
    database: memoryAdapter(tables),
    emailSender: {
      send: async ({ to }) => {
        sent.push(to);
      },
    },
    limiter: {
      consume: async (key) => {
        keys.push(key);
        // No `??` here: an undefined decision must reach the gate as-is.
        return options.decide ? options.decide(key) : allow;
      },
    },
    logger: silentLogger,
    clock: fixedClock('2026-09-20T00:00:00.000Z'),
    ids: sequentialId('auth'),
    appendSessionRevoked: async () => {},
    revokeOtherSessions: async () => 0,
  });
  const requestLink = async (address: string, extra?: HeadersInit) => {
    try {
      await server.instance.api.signInMagicLink({
        body: { email: address },
        headers: new Headers({ origin: env.PUBLIC_APP_URL, ...extra }),
      });
      return 'OK';
    } catch (error) {
      return String((error as { status?: unknown }).status);
    }
  };
  const getSession = (extra?: HeadersInit) =>
    server.instance.handler(
      new Request(`${env.PUBLIC_APP_URL}/api/auth/get-session`, {
        headers: new Headers(extra),
      }),
    );
  const serverSessionRead = (extra?: HeadersInit) =>
    server.instance.api.getSession({
      headers: new Headers(extra),
      query: { disableRefresh: true },
    });
  return { keys, sent, tables, requestLink, getSession, serverSessionRead };
};

const isRecipientKey = (key: string | undefined) =>
  /^auth:magic-link:recipient:[0-9a-f]{64}:\d+$/.test(key ?? '');
const isGlobalKey = (key: string | undefined) =>
  /^auth:magic-link:global:\d+$/.test(key ?? '');

describe('auth rate-limit gate: recipient bucket', () => {
  test('consumes the client bucket, three recipient windows and two global ceilings', async () => {
    const { keys, requestLink } = compose({});
    const outcome = await requestLink(email);
    assert({
      given: 'an allowed magic-link request with a recording limiter',
      should:
        'consume a client key, three hex recipient keys and two global keys, never the address',
      actual: {
        outcome,
        count: keys.length,
        clientFirst: keys[0]?.startsWith('auth:client:'),
        recipientKeys: keys.slice(1, 4).every(isRecipientKey),
        globalKeys: keys.slice(4, 6).every(isGlobalKey),
        leaksAddress: keys.some((key) => key.toLowerCase().includes('player')),
      },
      expected: {
        outcome: 'OK',
        count: 6,
        clientFirst: true,
        recipientKeys: true,
        globalKeys: true,
        leaksAddress: false,
      },
    });
  });

  test('normalizes the address before keying the bucket', async () => {
    const plain = compose({});
    const noisy = compose({});
    await plain.requestLink(email);
    await noisy.requestLink(' Player@Daisy.example.com ');
    assert({
      given: 'the same address with different case and padding',
      should: 'land in the identical recipient bucket',
      actual: {
        keyed: isRecipientKey(noisy.keys[1]),
        same: noisy.keys[1] === plain.keys[1],
      },
      expected: { keyed: true, same: true },
    });
  });

  test('a denied recipient bucket blocks the send', async () => {
    const { requestLink, sent, tables, keys } = compose({
      decide: (key) =>
        key.startsWith('auth:client:')
          ? allow
          : { allowed: false, retryAfterSeconds: 60 },
    });
    const outcome = await requestLink(email);
    assert({
      given: 'a limiter allowing the client key but denying the recipient key',
      should: 'reject with 429, send no mail and persist no verification',
      actual: {
        outcome,
        consumed: keys.length,
        sent: sent.length,
        verifications: tables.verification.length,
      },
      expected: {
        outcome: 'TOO_MANY_REQUESTS',
        consumed: 2,
        sent: 0,
        verifications: 0,
      },
    });
  });
});

describe('auth rate-limit gate: client identity', () => {
  test('ignores client-supplied forwarding headers by default', async () => {
    const forged = compose({});
    const bare = compose({});
    await forged.getSession({ 'x-forwarded-for': '198.51.100.9' });
    await bare.getSession();
    assert({
      given: 'no trusted client-IP header and a forged x-forwarded-for',
      should: 'keep the request in the shared per-path bucket',
      actual: {
        shared: forged.keys[0] === bare.keys[0],
        believed: forged.keys.some((key) => key.includes('198.51.100.9')),
      },
      expected: { shared: true, believed: false },
    });
  });

  test('trusts only the ingress-stamped header, never a second configurable one', async () => {
    const { keys, getSession } = compose({});
    await getSession({
      [CLIENT_IP_HEADER]: '203.0.113.7',
      'x-real-ip': '198.51.100.9',
      'x-forwarded-for': '198.51.100.9',
    });
    assert({
      given:
        'the ingress-stamped header alongside forged x-real-ip and x-forwarded-for',
      should: 'key the client bucket by the stamped header only',
      actual: keys,
      expected: ['auth:client:203.0.113.7:/get-session'],
    });
  });

  test('resolves the client for direct api calls from the stamped header', async () => {
    const { keys, requestLink } = compose({});
    await requestLink(email, { [CLIENT_IP_HEADER]: '203.0.113.7' });
    assert({
      given: 'a direct auth.api call carrying the ingress-stamped header',
      should: 'consume the client bucket for that address',
      actual: keys[0],
      expected: 'auth:client:203.0.113.7:/sign-in/magic-link',
    });
  });
});

describe('auth rate-limit gate: limiter decisions', () => {
  test('treats a malformed decision as a limiter outage', async () => {
    const malformed: unknown[] = [
      undefined,
      null,
      {},
      { allowed: 'yes', retryAfterSeconds: 0 },
    ];
    const statuses: number[] = [];
    for (const decision of malformed) {
      const { getSession } = compose({ decide: () => decision as Decision });
      statuses.push((await getSession()).status);
    }
    assert({
      given: 'limiter decisions without a boolean allowed flag',
      should: 'fail closed with 503 every time',
      actual: statuses,
      expected: [503, 503, 503, 503],
    });
  });

  test('emits Retry-After only as a non-negative integer', async () => {
    const hints: (string | null)[] = [];
    const statuses: number[] = [];
    for (const retryAfterSeconds of [12.2, Number.NaN, -5, Infinity]) {
      const { getSession } = compose({
        decide: () => ({ allowed: false, retryAfterSeconds }),
      });
      const response = await getSession();
      statuses.push(response.status);
      hints.push(response.headers.get('retry-after'));
    }
    assert({
      given: 'fractional, NaN, negative and infinite retry hints',
      should: 'round up a valid hint and omit the header for an invalid one',
      actual: { statuses, hints },
      expected: {
        statuses: [429, 429, 429, 429],
        hints: ['13', null, null, null],
      },
    });
  });
});

describe('auth rate-limit gate: server Principal reads', () => {
  test('a server-side session read spends no budget; the HTTP endpoint still does', async () => {
    const server = compose({});
    await server.serverSessionRead({ [CLIENT_IP_HEADER]: '203.0.113.7' });
    const afterServerRead = [...server.keys];
    await server.getSession({ [CLIENT_IP_HEADER]: '203.0.113.7' });
    assert({
      given:
        'a direct getSession call, then a browser GET /api/auth/get-session',
      should:
        'consume nothing for the first and the client bucket for the second',
      actual: { afterServerRead, afterHttp: server.keys },
      expected: {
        afterServerRead: [],
        afterHttp: ['auth:client:203.0.113.7:/get-session'],
      },
    });
  });

  test('other direct calls stay limited', async () => {
    const denied = compose({
      decide: () => ({ allowed: false, retryAfterSeconds: 5 }),
    });
    assert({
      given: 'a limiter that denies everything and a direct magic-link call',
      should: 'still refuse as too many requests',
      actual: await denied.requestLink(email),
      expected: 'TOO_MANY_REQUESTS',
    });
  });
});
