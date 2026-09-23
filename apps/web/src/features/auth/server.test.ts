import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { memoryAdapter } from '@better-auth/memory-adapter';
import type { BetterAuthOptions } from 'better-auth';
import { isAppError } from '@daisy/errors';
import { fixedClock, sequentialId } from '@daisy/clock';
import type { Logger } from '@daisy/logger';
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
    env: overrides?.env ?? env,
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
  test('composes the validated configuration from the injected environment', () => {
    assert({
      given: 'an environment holding the four required auth variables',
      should: 'expose the validated configuration with an empty proxy list',
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

  test('rejects an invalid environment reporting field names only', () => {
    let message = '';
    try {
      createAuthServer({
        env: { ...env, BETTER_AUTH_SECRET: 'short' },
        database: memoryAdapter({ user: [], session: [], account: [] }),
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
    } catch (error) {
      message = String(error);
    }
    assert({
      given: 'an environment with a short secret',
      should: 'fail composition naming the field without echoing the value',
      actual: {
        namesField: message.includes('BETTER_AUTH_SECRET'),
        echoesValue: message.includes('short'),
      },
      expected: { namesField: true, echoesValue: false },
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
      env,
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
      env,
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
    let appError = false;
    let code = '';
    let text = '';
    try {
      await server.mail.send(message);
    } catch (error) {
      appError = isAppError(error);
      code = String((error as { code?: string }).code);
      text = String(error);
    }
    assert({
      given: 'a failing email sender',
      should:
        'surface a factory-minted retryable error that never leaks the cause',
      actual: {
        appError,
        code,
        safeMessage: !text.includes('resend') && !text.includes('AB12CD'),
      },
      expected: { appError: true, code: 'INFRASTRUCTURE', safeMessage: true },
    });
  });
});
