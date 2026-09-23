import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { memoryAdapter } from '@better-auth/memory-adapter';
import { fixedClock, sequentialId } from '@daisy/clock';
import type { Logger } from '@daisy/logger';
import type { ClientIpTrust } from './rate-limit';
import { createAuthServer } from './server';

setupRitewayBun();

const baseEnv = {
  BETTER_AUTH_SECRET:
    '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  PUBLIC_APP_URL: 'http://localhost:3000',
  RESEND_API_KEY: 're_test_000000000000000000000000',
  AUTH_EMAIL_FROM: 'Daisy <no-reply@daisy.example.com>',
};
const silentLogger: Logger = { log: () => {}, child: () => silentLogger };

const compose = (options: {
  env?: Record<string, string>;
  clientIp?: ClientIpTrust;
}) => {
  const keys: string[] = [];
  const server = createAuthServer({
    env: { ...baseEnv, ...options.env },
    database: memoryAdapter({
      user: [],
      session: [],
      account: [],
      verification: [],
      passkey: [],
    }),
    emailSender: { send: async () => {} },
    limiter: {
      consume: async (key) => {
        keys.push(key);
        return { allowed: true, retryAfterSeconds: 0 };
      },
    },
    logger: silentLogger,
    clock: fixedClock('2026-09-20T00:00:00.000Z'),
    ids: sequentialId('auth'),
    appendSessionRevoked: async () => {},
    revokeOtherSessions: async () => 0,
    ...(options.clientIp ? { clientIp: options.clientIp } : {}),
  });
  const getSession = async (headers: Record<string, string> = {}) => {
    await server.instance.handler(
      new Request(`${baseEnv.PUBLIC_APP_URL}/api/auth/get-session`, {
        headers,
      }),
    );
    return keys;
  };
  return { getSession };
};

const forgedChain = {
  'x-real-ip': '203.0.113.7',
  'x-forwarded-for': '198.51.100.9, 203.0.113.8, 10.0.0.5',
};

describe('auth client-IP trust from configuration', () => {
  test('believes no header when the environment configures none', async () => {
    const forged = await compose({}).getSession(forgedChain);
    const bare = await compose({}).getSession();
    assert({
      given: 'no client-IP trust variables and forged forwarding headers',
      should: 'land the forged request in the shared per-path bucket',
      actual: {
        buckets: forged.length,
        shared: forged[0] === bare[0],
        believed: forged.some((key) => /198\.51|203\.0/.test(key)),
      },
      expected: { buckets: 1, shared: true, believed: false },
    });
  });

  test('keys clients by the header named in the environment', async () => {
    const keys = await compose({
      env: { AUTH_TRUSTED_IP_HEADERS: 'x-real-ip' },
    }).getSession(forgedChain);
    assert({
      given: 'AUTH_TRUSTED_IP_HEADERS naming x-real-ip',
      should: 'key the client bucket by that header only',
      actual: keys,
      expected: ['auth:client:203.0.113.7:/get-session'],
    });
  });

  test('walks a forwarded chain past the configured proxies', async () => {
    const keys = await compose({
      env: {
        AUTH_TRUSTED_IP_HEADERS: 'x-forwarded-for',
        AUTH_TRUSTED_PROXIES: '10.0.0.0/24',
      },
    }).getSession(forgedChain);
    assert({
      given: 'AUTH_TRUSTED_PROXIES covering the rightmost hop',
      should: 'pick the first untrusted hop from the right, not the forged one',
      actual: keys,
      expected: ['auth:client:203.0.113.8:/get-session'],
    });
  });

  test('an injected clientIp overrides the environment', async () => {
    const env = { AUTH_TRUSTED_IP_HEADERS: 'x-real-ip' };
    const replaced = await compose({
      env,
      clientIp: { trustedHeaders: ['cf-connecting-ip'] },
    }).getSession({ ...forgedChain, 'cf-connecting-ip': '192.0.2.44' });
    const cleared = await compose({
      env,
      clientIp: { trustedHeaders: [] },
    }).getSession(forgedChain);
    const bare = await compose({}).getSession();
    assert({
      given: 'an environment header plus an explicitly injected trust option',
      should: 'use only the injected option, including an injected empty list',
      actual: [replaced, cleared[0] === bare[0]],
      expected: [['auth:client:192.0.2.44:/get-session'], true],
    });
  });

  test('rejects an invalid proxy at composition', () => {
    let message = '';
    try {
      compose({ env: { AUTH_TRUSTED_PROXIES: 'proxy.internal' } });
    } catch (error) {
      message = String(error);
    }
    assert({
      given: 'a proxy entry that is neither an IP address nor a CIDR range',
      should: 'fail composition naming the field without echoing the value',
      actual: [
        message.includes('AUTH_TRUSTED_PROXIES'),
        message.includes('proxy.internal'),
      ],
      expected: [true, false],
    });
  });

  test('every accepted proxy form is honored by Better Auth', async () => {
    // Contract: configuration must accept only what Better Auth 1.7.5 acts
    // on. A proxy entry it drops leaves the chain unbelieved, so the request
    // would fall into the shared bucket instead of the client's.
    const accepted: (readonly [entry: string, proxyHop: string])[] = [
      ['10.0.0.5', '10.0.0.5'],
      ['10.0.0.0/8', '10.1.2.3'],
      ['192.0.2.0/24', '192.0.2.1'],
      ['10.0.0.5/32', '10.0.0.5'],
      ['2001:db8::1', '2001:db8::1'],
      ['2001:DB8::/32', '2001:db8:1::9'],
      ['2001:db8::1/128', '2001:db8::1'],
      ['::1', '::1'],
    ];
    const keys = await Promise.all(
      accepted.map(async ([entry, proxyHop]) => {
        const consumed = await compose({
          env: {
            AUTH_TRUSTED_IP_HEADERS: 'x-forwarded-for',
            AUTH_TRUSTED_PROXIES: entry,
          },
        }).getSession({
          'x-forwarded-for': `198.51.100.9, 203.0.113.8, ${proxyHop}`,
        });
        return consumed[0];
      }),
    );
    assert({
      given: 'each proxy form the configuration accepts, behind a hop chain',
      should: 'skip the proxy hop and key the first untrusted hop as client',
      actual: keys,
      expected: accepted.map(() => 'auth:client:203.0.113.8:/get-session'),
    });
  });

  test('rejects IPv4-mapped IPv6 proxy ranges at composition', () => {
    const mapped = [
      '::ffff:10.0.0.0/104',
      '::ffff:a00:0/104',
      '0:0:0:0:0:ffff:10.0.0.1/120',
    ];
    assert({
      given: 'mapped ranges Better Auth would drop with only a warning',
      should: 'refuse to compose rather than run with an untrusted proxy',
      actual: mapped.map((entry) => {
        try {
          compose({ env: { AUTH_TRUSTED_PROXIES: entry } });
          return 'composed';
        } catch (error) {
          return String(error);
        }
      }),
      expected: mapped.map(
        () => 'Error: Invalid auth configuration: AUTH_TRUSTED_PROXIES.0',
      ),
    });
  });
});
