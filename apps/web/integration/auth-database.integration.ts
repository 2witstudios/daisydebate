import { SQL } from 'bun';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { fixedClock, sequentialId } from '@daisy/clock';
import { createDatabase } from '@daisy/db';
import type { Logger } from '@daisy/logger';
import {
  createAuthServer,
  type AuthEmailMessage,
} from '../src/features/auth/server';

setupRitewayBun();

const url = process.env.TEST_DATABASE_URL;
if (!url)
  throw new Error(
    'TEST_DATABASE_URL required; never use application database for tests',
  );
if (!new URL(url).pathname.endsWith('_test'))
  throw new Error('Test database name must end in _test');

const env = {
  BETTER_AUTH_SECRET:
    '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  PUBLIC_APP_URL: 'http://localhost:3000',
  RESEND_API_KEY: 're_test_000000000000000000000000',
  AUTH_EMAIL_FROM: 'Daisy <no-reply@daisy.example.com>',
};

const logger: Logger = {
  log: () => {},
  child: () => logger,
};

test('Better Auth persists through the existing database pool', async () => {
  const email = `auth-${crypto.randomUUID()}@example.test`;
  const sent: AuthEmailMessage[] = [];
  const database = createDatabase({ url });
  const auth = createAuthServer({
    env,
    database: database.authAdapter,
    emailSender: {
      send: async (message) => {
        sent.push(message);
      },
    },
    limiter: {
      consume: async () => ({ allowed: true, retryAfterSeconds: 0 }),
    },
    logger,
    clock: fixedClock('2026-09-20T00:00:00.000Z'),
    ids: sequentialId('auth-integration'),
  });

  try {
    const result = await auth.instance.api.signInMagicLink({
      body: { email },
      headers: new Headers({ origin: env.PUBLIC_APP_URL }),
    });

    assert({
      given: 'a magic-link request using the existing Bun SQL pool',
      should: 'persist verification state and send one account-neutral message',
      actual: {
        status: result.status,
        sent: sent.map(({ to, subject }) => ({ to, subject })),
      },
      expected: {
        status: true,
        sent: [{ to: email, subject: 'Sign in to Daisy' }],
      },
    });
  } finally {
    await database.close();
    const cleanup = new SQL(url);
    try {
      await cleanup.unsafe('delete from users where email = $1', [email]);
      await cleanup.unsafe(
        'delete from verification where identifier like $1',
        [`%${email}%`],
      );
    } finally {
      await cleanup.close();
    }
  }
});
