import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from '@better-auth/memory-adapter';
import { fixedClock, sequentialId } from '@daisy/clock';
import type { Logger } from '@daisy/logger';
import { logsLeakSecrets } from './log-leaks';
import { createRateLimitGate, type ClientIpTrust } from './rate-limit';
import { createAuthServer } from './server';

setupRitewayBun();

const env = {
  BETTER_AUTH_SECRET:
    '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  PUBLIC_APP_URL: 'http://localhost:3000',
  RESEND_API_KEY: 're_test_000000000000000000000000',
  AUTH_EMAIL_FROM: 'Daisy <no-reply@daisy.example.com>',
};
const silentLogger: Logger = { log: () => {}, child: () => silentLogger };
const emptyTables = () => ({
  user: [],
  session: [],
  account: [],
  verification: [],
  passkey: [],
});

const composeServer = (clientIp: ClientIpTrust | undefined, keys: string[]) =>
  createAuthServer({
    env,
    database: memoryAdapter(emptyTables()),
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
    clientIp,
  });

describe('auth rate-limit gate: recipient digest', () => {
  test('keys the recipient bucket by SHA3-256 of the normalized address', async () => {
    const keys: string[] = [];
    await composeServer(undefined, keys).instance.api.signInMagicLink({
      body: { email: 'Player@Daisy.example.com' },
      headers: new Headers({ origin: env.PUBLIC_APP_URL }),
    });
    assert({
      given: 'a magic-link request for a fixed address',
      should: 'consume the bucket named by its known SHA3-256 digest',
      actual: keys[1],
      // Independent reference value (hashlib.sha3_256 / openssl dgst
      // -sha3-256 of "player@daisy.example.com"), never derived in-test.
      expected:
        'auth:magic-link:recipient:a18f2158138c63548f957744a4e3383ecf6bfd970d80168d1fffd58fe1267c07',
    });
  });
});

describe('auth rate-limit gate: client-IP trust configuration', () => {
  test('rejects an invalid trusted header name at composition', () => {
    const attempt = (clientIp: ClientIpTrust) => {
      try {
        composeServer(clientIp, []);
        return 'composed';
      } catch (error) {
        return String(error);
      }
    };
    assert({
      given: 'trusted header names that are not valid HTTP field names',
      should:
        'fail fast naming the option without echoing the value, and accept valid names',
      actual: [
        attempt({ trustedHeaders: ['bad header'] }),
        attempt({ trustedHeaders: ['x-real-ip', ''] }),
        attempt({ trustedHeaders: ['X-Real-IP', 'cf-connecting-ip'] }),
      ],
      expected: [
        'Error: Invalid auth configuration: clientIp.trustedHeaders',
        'Error: Invalid auth configuration: clientIp.trustedHeaders',
        'composed',
      ],
    });
  });

  test('a client resolver that throws at request time fails closed', async () => {
    const consumed: string[] = [];
    const logged: (readonly unknown[])[] = [];
    const logger: Logger = {
      log: (...entry) => {
        logged.push(entry);
      },
      child: () => logger,
    };
    const auth = betterAuth({
      baseURL: env.PUBLIC_APP_URL,
      secret: env.BETTER_AUTH_SECRET,
      database: memoryAdapter(emptyTables()),
      rateLimit: { enabled: false },
      hooks: {
        before: createRateLimitGate({
          limiter: {
            consume: async (key) => {
              consumed.push(key);
              return { allowed: true, retryAfterSeconds: 0 };
            },
          },
          logger,
          resolveClient: () => {
            throw new TypeError('Header name 198.51.100.9 is invalid');
          },
        }),
      },
    });
    const response = await auth.handler(
      new Request(`${env.PUBLIC_APP_URL}/api/auth/get-session`),
    );
    assert({
      given: 'client resolution throwing inside the gate',
      should:
        'answer 503 with one safe log entry and never proceed past the gate',
      actual: {
        status: response.status,
        consumed,
        logged: logged.map(([event, fields]) => [event, fields]),
        leaks: logsLeakSecrets(logged, ['198.51.100.9', 'Header name']),
      },
      expected: {
        status: 503,
        consumed: [],
        logged: [
          [
            'auth.rate_limit.unavailable',
            {
              operation: 'auth.rate_limit',
              path: '/get-session',
              errorCode: 'INFRASTRUCTURE',
            },
          ],
        ],
        leaks: false,
      },
    });
  });
});
