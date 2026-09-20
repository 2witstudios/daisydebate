import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { memoryAdapter } from '@better-auth/memory-adapter';
import { fixedClock, sequentialId } from '@daisy/clock';
import type { Logger } from '@daisy/logger';
import { createAuthServer, type AuthEmailMessage } from './server';

setupRitewayBun();

const env = {
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

function capturingSender() {
  const sent: AuthEmailMessage[] = [];
  return {
    sent,
    send: async (input: AuthEmailMessage) => {
      sent.push(input);
    },
  };
}

const create = (overrides?: {
  env?: Record<string, string | undefined>;
  emailSender?: ReturnType<typeof capturingSender>;
}) =>
  createAuthServer({
    env: overrides?.env ?? env,
    database: memoryAdapter({
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
  });

describe('auth instance composition', () => {
  test('composes the Better Auth instance from the validated configuration', async () => {
    const server = create();
    const { options } = await server.instance.$context;
    assert({
      given: 'the validated auth configuration',
      should:
        'wire baseURL, the trusted application origin and the secret with passwords disabled',
      actual: {
        baseURL: options.baseURL,
        trustedOrigins: options.trustedOrigins,
        passwordEnabled: options.emailAndPassword?.enabled,
        idGenerator: options.advanced?.database?.generateId,
      },
      expected: {
        baseURL: 'http://localhost:3000',
        trustedOrigins: ['http://localhost:3000'],
        passwordEnabled: false,
        idGenerator: 'uuid',
      },
    });
  });

  test('configures magic-link and passkey with a relying party derived from the application URL', async () => {
    const server = create({
      env: { ...env, PUBLIC_APP_URL: 'https://daisy.example.com' },
    });
    const { options } = await server.instance.$context;
    const byId = new Map(
      (options.plugins ?? []).map((plugin) => [
        plugin.id,
        plugin.options as Record<string, unknown>,
      ]),
    );
    assert({
      given: 'a validated application URL',
      should:
        'enable magic-link and passkey with the RP identity derived from the origin',
      actual: {
        magicLinkSender: typeof byId.get('magic-link')?.sendMagicLink,
        rpID: byId.get('passkey')?.rpID,
        rpName: byId.get('passkey')?.rpName,
        origin: byId.get('passkey')?.origin,
      },
      expected: {
        magicLinkSender: 'function',
        rpID: 'daisy.example.com',
        rpName: 'Daisy',
        origin: 'https://daisy.example.com',
      },
    });
  });

  test('delivers requested magic links through the injected sender', async () => {
    const sender = capturingSender();
    const server = create({ emailSender: sender });
    await server.instance.api.signInMagicLink({
      body: { email: 'player@daisy.example.com' },
      headers: new Headers({ origin: 'http://localhost:3000' }),
    });
    assert({
      given: 'a magic-link sign-in request',
      should: 'deliver exactly one message through the injected sender',
      actual: sender.sent.map(({ to, subject }) => ({ to, subject })),
      expected: [
        { to: 'player@daisy.example.com', subject: 'Sign in to Daisy' },
      ],
    });
  });

  test('refuses direct calls to password signup, signin and reset endpoints', async () => {
    const server = create();
    const passwords = ['Sup3rSecret!', 'Sup3rSecret!', 'Sup3rSecret!'];
    const paths = [
      '/api/auth/sign-up/email',
      '/api/auth/sign-in/email',
      '/api/auth/forget-password',
    ];
    const statuses = [];
    const setCookies = [];
    for (const [index, path] of paths.entries()) {
      const response = await server.instance.handler(
        new Request(`http://localhost:3000${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            email: 'player@daisy.example.com',
            password: passwords[index],
          }),
        }),
      );
      statuses.push(response.status);
      setCookies.push(response.headers.has('set-cookie'));
    }
    assert({
      given: 'direct calls to password signup, signin and reset endpoints',
      should: 'refuse every password route without issuing a session',
      actual: { statuses, setCookies },
      expected: {
        statuses: [400, 400, 404],
        setCookies: [false, false, false],
      },
    });
  });
});
