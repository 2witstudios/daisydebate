import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { fixedClock, systemId } from '@daisy/clock';
import { readAuthConfig } from '@daisy/config';
import type { Logger } from '@daisy/logger';
import {
  createAuthServer,
  type AuthEmailMessage,
} from '../src/features/auth/server';
import { createConfirmHandlers } from '../src/features/auth/confirm';
import type { RecordedLogs } from '../src/features/auth/log-leaks';
import { silentLogger } from '../src/server/test-loggers.test-support';

/** Shared fixtures for the isolated Better Auth persistence suites. */

const integrationEnv = {
  NODE_ENV: 'test',
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

export type SentMessages = AuthEmailMessage[];

/**
 * Redeems a magic-link token the way a person does: POST to the same-origin
 * confirm page, which forwards into Better Auth internally
 * (`confirm-http-shared.ts`'s `createForward` calls `server.handler`
 * directly, never through the mounted `/api/auth` route). A direct GET to
 * `/api/auth/magic-link/verify` is refused by the mounted route (ISSUE-3),
 * so tests must never build that URL and hit it themselves.
 */
export const redeemMagicLink = (
  auth: {
    readonly instance: {
      readonly handler: (request: Request) => Promise<Response>;
    };
    readonly config: { readonly PUBLIC_APP_URL: string };
  },
  token: string,
  extra: Record<string, string> = {},
) =>
  createConfirmHandlers({
    auth: () => ({ handler: auth.instance.handler, config: auth.config }),
    logger: silentLogger,
  }).POST(
    new Request(`${auth.config.PUBLIC_APP_URL}/auth/confirm`, {
      method: 'POST',
      headers: {
        origin: auth.config.PUBLIC_APP_URL,
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        token,
        callbackURL: '/',
        ...extra,
      }).toString(),
    }),
  );

export const createTestAuthServer = (
  database: Parameters<typeof createAuthServer>[0]['database'],
  options: {
    readonly sent: SentMessages;
    readonly deliveryFailure?: Error;
    readonly recordedLogs?: RecordedLogs;
    /** Defaults to a no-op; a suite proving RT-2.2's outbox append wires the real one. */
    readonly appendSessionRevoked?: (userId: string) => Promise<void>;
    /** Defaults to a no-op; a suite proving ISSUE-3 AC3 wires the real one. */
    readonly revokeOtherSessions?: (
      userId: string,
      keepToken: string,
    ) => Promise<number>;
  },
) =>
  createAuthServer({
    config: readAuthConfig(integrationEnv),
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
    appendSessionRevoked: options.appendSessionRevoked ?? (async () => {}),
    revokeOtherSessions: options.revokeOtherSessions ?? (async () => 0),
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

/**
 * Forces one genuine Postgres-level `appendOutboxEvent` failure (RT-2.2v
 * minor 3), scoped to exactly one topic: a `BEFORE INSERT` trigger that
 * raises only for that topic's rows, dropped again once `work` settles.
 * turbo runs `@daisy/db` and `@daisy/web` `test:integration` concurrently
 * against one `TEST_DATABASE_URL` (`turbo.json`, no ordering); renaming the
 * shared `outbox` table away for the duration of `work` would fail every
 * unrelated insert and drain running at the same time and hold an ACCESS
 * EXCLUSIVE lock for that whole window. A topic-scoped trigger holds that
 * lock only for the brief `CREATE`/`DROP TRIGGER` DDL, and only rejects
 * inserts naming this fixture's own topic. Two real consumers:
 * `auth-session-revoked-outbox.integration.ts` and
 * `auth-email-change-atomicity.integration.ts`.
 */
export const withOutboxInsertBlockedForTopic = async (
  url: string,
  topic: string,
  work: () => Promise<void>,
) => {
  const admin = new SQL(url);
  const name = `outbox_force_failure_${createId()}`;
  const escapedTopic = topic.replace(/'/g, "''");
  try {
    await admin.unsafe(`
      create function "${name}"() returns trigger as $body$
      begin
        if new.topic = '${escapedTopic}' then
          raise exception 'forced outbox failure for topic % (fixture-scoped)', new.topic;
        end if;
        return new;
      end;
      $body$ language plpgsql
    `);
    await admin.unsafe(`
      create trigger "${name}_trigger" before insert on outbox
      for each row execute function "${name}"()
    `);
    await work();
  } finally {
    await admin.unsafe(`drop trigger if exists "${name}_trigger" on outbox`);
    await admin.unsafe(`drop function if exists "${name}"()`);
    await admin.close();
  }
};
