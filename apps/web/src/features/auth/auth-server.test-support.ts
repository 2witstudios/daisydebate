import { memoryAdapter } from '@better-auth/memory-adapter';
import { fixedClock, sequentialId } from '@daisy/clock';
import { readAuthConfig } from '@daisy/config';
import { silentLogger } from '../../server/test-loggers.test-support';
import { createAuthServer, type AuthEmailMessage } from './server';

/**
 * Shared fixtures for the auth suites: one env (the integration apps are
 * built from it too), one composed server.
 */

export const authTestEnv = {
  NODE_ENV: 'test',
  BETTER_AUTH_SECRET:
    '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  PUBLIC_APP_URL: 'http://localhost:3000',
  RESEND_API_KEY: 're_test_000000000000000000000000',
  AUTH_EMAIL_FROM: 'Daisy <no-reply@daisy.example.com>',
};

/** Fresh in-memory Better Auth tables a test can inspect after the fact. */
export const memoryTables = () => ({
  user: [] as Array<Record<string, unknown>>,
  session: [] as Array<Record<string, unknown>>,
  account: [] as Array<Record<string, unknown>>,
  verification: [] as Array<Record<string, unknown>>,
  passkey: [] as Array<Record<string, unknown>>,
});

/** A mail seam that keeps every message it was asked to send. */
export function capturingSender() {
  const sent: AuthEmailMessage[] = [];
  return {
    sent,
    send: async (input: AuthEmailMessage) => {
      sent.push(input);
    },
  };
}

/**
 * The auth server composed over in-memory tables, a fixed clock and
 * sequential ids, with an allowing limiter and no-op seams; a test overrides
 * only the seams it exercises.
 */
export const composeAuthServer = (
  overrides: Partial<Parameters<typeof createAuthServer>[0]> = {},
) =>
  createAuthServer({
    config: readAuthConfig(authTestEnv),
    database: memoryAdapter(memoryTables()),
    emailSender: capturingSender(),
    limiter: { consume: async () => ({ allowed: true, retryAfterSeconds: 0 }) },
    logger: silentLogger,
    clock: fixedClock('2026-09-20T00:00:00.000Z'),
    ids: sequentialId('auth'),
    appendSessionRevoked: async () => {},
    revokeOtherSessions: async () => 0,
    ...overrides,
  });

/** Requests a magic link through the API: 'OK' or the refusal's status. */
export const requestLinkStatus = async (
  server: ReturnType<typeof createAuthServer>,
  email: string,
  headers?: HeadersInit,
) => {
  try {
    await server.instance.api.signInMagicLink({
      body: { email },
      headers: new Headers({ origin: authTestEnv.PUBLIC_APP_URL, ...headers }),
    });
    return 'OK';
  } catch (error) {
    return String((error as { status?: unknown }).status);
  }
};
