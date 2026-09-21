import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { memoryAdapter } from '@better-auth/memory-adapter';
import { fixedClock, sequentialId } from '@daisy/clock';
import type { Logger } from '@daisy/logger';
import type { AuthRateLimiter } from './rate-limit';
import { createAuthServer } from './server';

setupRitewayBun();

const env = {
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

const compose = (options: {
  decide?: (key: string) => Decision;
  clientIp?: Parameters<typeof createAuthServer>[0]['clientIp'];
}) => {
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
    env,
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
    clientIp: options.clientIp,
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
  return { keys, sent, tables, requestLink, getSession };
};

const isRecipientKey = (key: string | undefined) =>
  /^auth:magic-link:recipient:[0-9a-f]{64}$/.test(key ?? '');

describe('auth rate-limit gate: recipient bucket', () => {
  test('consumes a digest-keyed recipient bucket after the client bucket', async () => {
    const { keys, requestLink } = compose({});
    const outcome = await requestLink(email);
    assert({
      given: 'an allowed magic-link request with a recording limiter',
      should:
        'consume a client key, then a hex recipient key, never the address',
      actual: {
        outcome,
        count: keys.length,
        clientFirst: keys[0]?.startsWith('auth:client:'),
        recipientSecond: isRecipientKey(keys[1]),
        leaksAddress: keys.some((key) => key.toLowerCase().includes('player')),
      },
      expected: {
        outcome: 'OK',
        count: 2,
        clientFirst: true,
        recipientSecond: true,
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

  test('honors a configured trusted header', async () => {
    const { keys, getSession } = compose({
      clientIp: { trustedHeaders: ['x-real-ip'] },
    });
    await getSession({
      'x-real-ip': '203.0.113.7',
      'x-forwarded-for': '198.51.100.9',
    });
    assert({
      given: 'x-real-ip configured as the trusted client-IP header',
      should: 'key the client bucket by that address only',
      actual: keys,
      expected: ['auth:client:203.0.113.7:/get-session'],
    });
  });

  test('resolves the client for direct api calls from forwarded headers', async () => {
    const { keys, requestLink } = compose({
      clientIp: { trustedHeaders: ['x-real-ip'] },
    });
    await requestLink(email, { 'x-real-ip': '203.0.113.7' });
    assert({
      given: 'a direct auth.api call carrying the trusted header',
      should: 'consume the client bucket for that address',
      actual: keys[0],
      expected: 'auth:client:203.0.113.7:/sign-in/magic-link',
    });
  });

  test('resolves a multi-hop chain deterministically', async () => {
    const chain = { 'x-forwarded-for': '198.51.100.9, 203.0.113.7, 10.0.0.5' };
    const withProxies = compose({
      clientIp: {
        trustedHeaders: ['x-forwarded-for'],
        trustedProxies: ['10.0.0.0/24'],
      },
    });
    const withoutProxies = compose({
      clientIp: { trustedHeaders: ['x-forwarded-for'] },
    });
    const bare = compose({ clientIp: { trustedHeaders: ['x-forwarded-for'] } });
    await withProxies.getSession(chain);
    await withoutProxies.getSession(chain);
    await bare.getSession();
    assert({
      given: 'a three-hop chain whose leftmost hop is client-forged',
      should:
        'pick the first untrusted hop from the right, or the shared bucket when no proxies are declared',
      actual: {
        withProxies: withProxies.keys,
        withoutProxiesShared: withoutProxies.keys[0] === bare.keys[0],
      },
      expected: {
        withProxies: ['auth:client:203.0.113.7:/get-session'],
        withoutProxiesShared: true,
      },
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
