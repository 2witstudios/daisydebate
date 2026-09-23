import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { memoryAdapter } from '@better-auth/memory-adapter';
import type { BetterAuthOptions } from 'better-auth';
import { assertRejects } from '@daisy/errors/testing';
import {
  authTestEnv,
  capturingSender,
  composeAuthServer,
  memoryTables,
} from './auth-server.test-support';
import type { AuthEmailMessage } from './server';

setupRitewayBun();

const message: AuthEmailMessage = {
  to: 'player@daisy.example.com',
  subject: 'Sign in to Daisy',
  text: 'Open the link to continue.',
  html: '<p>Open the link to continue.</p>',
};

describe('auth server composition', () => {
  test('exposes the validated configuration it was given', () => {
    assert({
      given: 'configuration validated from the four required auth variables',
      should: 'expose it with an empty proxy list',
      actual: composeAuthServer().config,
      expected: {
        BETTER_AUTH_SECRET: authTestEnv.BETTER_AUTH_SECRET,
        PUBLIC_APP_URL: authTestEnv.PUBLIC_APP_URL,
        RESEND_API_KEY: authTestEnv.RESEND_API_KEY,
        AUTH_EMAIL_FROM: authTestEnv.AUTH_EMAIL_FROM,
        AUTH_TRUSTED_PROXIES: [],
      },
    });
  });

  test('composes lazily without querying the injected database adapter', async () => {
    let adapterQueries = 0;
    const underlying = memoryAdapter(memoryTables());
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
    const server = composeAuthServer({ database });
    const composed = {
      configValidated:
        server.config.BETTER_AUTH_SECRET === authTestEnv.BETTER_AUTH_SECRET,
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
    const server = composeAuthServer({ emailSender: sender });
    await server.mail.send(message);
    assert({
      given: 'a capturing email sender',
      should: 'pass the message through untouched',
      actual: sender.sent,
      expected: [message],
    });
  });

  test('maps sender failure to a retryable error without provider detail', async () => {
    const server = composeAuthServer({
      emailSender: {
        send: async () => {
          throw new Error('resend provider exception AB12CD');
        },
      },
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
