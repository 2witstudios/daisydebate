import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { memoryAdapter } from '@better-auth/memory-adapter';
import type { BetterAuthOptions } from 'better-auth';
import { readAuthConfig } from '@daisy/config';
import { fixedClock, sequentialId } from '@daisy/clock';
import type { Logger } from '@daisy/logger';
import { assertRejects } from '@daisy/errors/testing';
import { createAuthServer, type AuthEmailMessage } from './server';

setupRitewayBun();

const env = {
  NODE_ENV: 'test',
  BETTER_AUTH_SECRET:
    '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  PUBLIC_APP_URL: 'http://localhost:3000',
  RESEND_API_KEY: 're_test_000000000000000000000000',
  AUTH_EMAIL_FROM: 'Daisy <no-reply@daisy.example.com>',
};

const silentLogger: Logger = {
  log: () => {},
  child: () => silentLogger,
};

const message: AuthEmailMessage = {
  to: 'player@daisy.example.com',
  subject: 'Sign in to Daisy',
  text: 'Open the link to continue.',
  html: '<p>Open the link to continue.</p>',
};

const create = (overrides?: {
  env?: Record<string, string | undefined>;
  emailSender?: ReturnType<typeof capturingSender>;
  database?: BetterAuthOptions['database'];
}) =>
  createAuthServer({
    config: readAuthConfig(overrides?.env ?? env),
    database:
      overrides?.database ??
      memoryAdapter({
        user: [],
        session: [],
        account: [],
        verification: [],
        passkey: [],
      }),
    emailSender: overrides?.emailSender ?? capturingSender(),
    limiter: { consume: async () => ({ allowed: true, retryAfterSeconds: 0 }) },
    logger: silentLogger,
    clock: fixedClock('2026-09-20T00:00:00.000Z'),
    ids: sequentialId('auth'),
    appendSessionRevoked: async () => {},
    revokeOtherSessions: async () => 0,
  });

function capturingSender() {
  const sent: AuthEmailMessage[] = [];
  return {
    sent,
    send: async (input: AuthEmailMessage) => {
      sent.push(input);
    },
  };
}

describe('auth server composition', () => {
  test('exposes the validated configuration it was given', () => {
    assert({
      given: 'configuration validated from the four required auth variables',
      should: 'expose it with an empty proxy list',
      actual: create().config,
      expected: {
        BETTER_AUTH_SECRET: env.BETTER_AUTH_SECRET,
        PUBLIC_APP_URL: env.PUBLIC_APP_URL,
        RESEND_API_KEY: env.RESEND_API_KEY,
        AUTH_EMAIL_FROM: env.AUTH_EMAIL_FROM,
        AUTH_TRUSTED_PROXIES: [],
      },
    });
  });

  test('composes lazily without querying the injected database adapter', async () => {
    let adapterQueries = 0;
    const underlying = memoryAdapter({
      user: [],
      session: [],
      account: [],
      verification: [],
      passkey: [],
    });
    const database: BetterAuthOptions['database'] = (options) => {
      const adapter = underlying(options);
      return new Proxy(adapter, {
        get(target, property) {
          const value = Reflect.get(target, property);
          if (typeof value !== 'function') return value;
          return (...args: readonly unknown[]) => {
            adapterQueries += 1;
            return value.apply(target, args);
          };
        },
      });
    };
    const server = createAuthServer({
      config: readAuthConfig(env),
      database,
      emailSender: capturingSender(),
      limiter: {
        consume: async () => ({ allowed: true, retryAfterSeconds: 0 }),
      },
      logger: silentLogger,
      clock: fixedClock('2026-09-20T00:00:00.000Z'),
      ids: sequentialId('auth'),
      appendSessionRevoked: async () => {},
      revokeOtherSessions: async () => 0,
    });
    const composed = {
      configValidated:
        server.config.BETTER_AUTH_SECRET === env.BETTER_AUTH_SECRET,
      adapterQueries,
    };
    await server.instance.api.signInMagicLink({
      body: { email: 'player@daisy.example.com' },
      headers: new Headers({ origin: 'http://localhost:3000' }),
    });
    assert({
      given: 'a query-counting database adapter',
      should:
        'compose the validated configuration with zero queries and reach the adapter only through operations',
      actual: {
        composed,
        reachedAdapterOnlyThroughOperations: adapterQueries > 0,
      },
      expected: {
        composed: { configValidated: true, adapterQueries: 0 },
        reachedAdapterOnlyThroughOperations: true,
      },
    });
  });

  test('delivers mail through the injected sender exactly once', async () => {
    const sender = capturingSender();
    const server = create({ emailSender: sender });
    await server.mail.send(message);
    assert({
      given: 'a capturing email sender',
      should: 'pass the message through untouched',
      actual: sender.sent,
      expected: [message],
    });
  });

  test('maps sender failure to a retryable error without provider detail', async () => {
    const server = createAuthServer({
      config: readAuthConfig(env),
      database: memoryAdapter({ user: [], session: [], account: [] }),
      emailSender: {
        send: async () => {
          throw new Error('resend provider exception AB12CD');
        },
      },
      limiter: {
        consume: async () => ({ allowed: true, retryAfterSeconds: 0 }),
      },
      logger: silentLogger,
      clock: fixedClock('2026-09-20T00:00:00.000Z'),
      ids: sequentialId('auth'),
      appendSessionRevoked: async () => {},
      revokeOtherSessions: async () => 0,
    });
    await assertRejects({
      given: 'a failing email sender',
      should: 'surface a factory-minted retryable INFRASTRUCTURE error',
      actual: () => server.mail.send(message),
      code: 'INFRASTRUCTURE',
    });
    const text = await server.mail.send(message).then(
      () => 'delivered',
      (error: unknown) => String(error),
    );
    assert({
      given: 'a failing email sender',
      should: 'never leak the provider cause in the surfaced error',
      actual: {
        provider: text.includes('resend'),
        code: text.includes('AB12CD'),
      },
      expected: { provider: false, code: false },
    });
  });
});
