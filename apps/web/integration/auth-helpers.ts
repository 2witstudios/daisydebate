import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { fixedClock, systemId } from '@daisy/clock';
import type { Logger } from '@daisy/logger';
import {
  createAuthServer,
  type AuthEmailMessage,
} from '../src/features/auth/server';
import type { RecordedLogs } from '../src/features/auth/log-leaks';

/** Shared fixtures for the isolated Better Auth persistence suites. */

const integrationEnv = {
  BETTER_AUTH_SECRET:
    '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  PUBLIC_APP_URL: 'http://localhost:3000',
  RESEND_API_KEY: 're_test_000000000000000000000000',
  AUTH_EMAIL_FROM: 'Daisy <no-reply@daisy.example.com>',
};

// Child loggers record into the same sink, so nothing logged is hidden.
const recordingLogger = (recordedLogs: RecordedLogs | undefined): Logger => ({
  log: (...entry) => {
    recordedLogs?.push(entry);
  },
  child: () => recordingLogger(recordedLogs),
});

export const fixtureEmail = () => `auth-${createId()}@example.test`;

// Better Auth stores the magic-link token in `identifier` and the bound
// account payload (containing the email) in `value`.
export const verificationValue = (email: string) => JSON.stringify({ email });

export const isCuid2 = (value: string) => /^[a-z0-9]{24}$/.test(value);

export const isDate = (value: unknown): value is Date => value instanceof Date;

export const expiresWithinMagicLinkWindow = (expiresAt: Date) =>
  Math.abs(expiresAt.getTime() - Date.now() - 300_000) < 60_000;

export const capturedToken = (message: AuthEmailMessage) => {
  const link = new URL(message.text.match(/https?:\/\/\S+/)?.[0] ?? '');
  return link.searchParams.get('token') ?? '';
};

export const verifyUrl = (token: string) =>
  `${integrationEnv.PUBLIC_APP_URL}/api/auth/magic-link/verify?token=${encodeURIComponent(token)}`;

export type SentMessages = AuthEmailMessage[];

export const createTestAuthServer = (
  database: Parameters<typeof createAuthServer>[0]['database'],
  options: {
    readonly sent: SentMessages;
    readonly deliveryFailure?: Error;
    readonly recordedLogs?: RecordedLogs;
  },
) =>
  createAuthServer({
    env: integrationEnv,
    database,
    emailSender: {
      send: async (message) => {
        if (options.deliveryFailure) throw options.deliveryFailure;
        options.sent.push(message);
      },
    },
    limiter: {
      consume: async () => ({ allowed: true, retryAfterSeconds: 0 }),
    },
    logger: recordingLogger(options.recordedLogs),
    clock: fixedClock('2026-09-20T00:00:00.000Z'),
    // The composition mints entity ids from this injection; the durable
    // suites share one database, so they need the real cuid2 edge generator.
    ids: systemId,
  });

/** Removes exactly this fixture's records; never touches unrelated rows. */
export const removeFixture = async (
  url: string,
  email: string,
  userId: string | undefined,
  passkeyIds: readonly string[],
) => {
  const cleanup = new SQL(url);
  try {
    for (const id of passkeyIds)
      await cleanup.unsafe('delete from passkey where id = $1', [id]);
    if (userId)
      await cleanup.unsafe('delete from users where id = $1', [userId]);
    await cleanup.unsafe('delete from verification where value = $1', [
      verificationValue(email),
    ]);
  } finally {
    await cleanup.close();
  }
};

export type FixtureCounts = {
  verifications: number;
  users: number;
  sessions: number;
  passkeys: number;
};

export const countFixtureRows = async (
  url: string,
  email: string,
  userId: string | undefined,
): Promise<FixtureCounts> => {
  const count = async (query: string, params: unknown[]) => {
    const probe = new SQL(url);
    try {
      const rows = await probe.unsafe(query, params);
      return rows[0]?.c ?? 0;
    } finally {
      await probe.close();
    }
  };
  // Count by exact value first, then by containment of the unique fixture
  // email: if Better Auth ever adds fields to the stored payload, the exact
  // delete in removeFixture would match nothing and this count must still
  // expose the leftover instead of silently passing.
  const verifications = await count(
    'select count(*)::int as c from verification where value = $1 or value like $2',
    [verificationValue(email), `%${email}%`],
  );
  const users = userId
    ? await count('select count(*)::int as c from users where id = $1', [
        userId,
      ])
    : 0;
  const sessions = userId
    ? await count('select count(*)::int as c from session where user_id = $1', [
        userId,
      ])
    : 0;
  const passkeys = userId
    ? await count('select count(*)::int as c from passkey where user_id = $1', [
        userId,
      ])
    : 0;
  return { verifications, users, sessions, passkeys };
};

export const emptyCounts: FixtureCounts = {
  verifications: 0,
  users: 0,
  sessions: 0,
  passkeys: 0,
};
