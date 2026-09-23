import { afterAll, setDefaultTimeout } from 'bun:test';
import { RedisClient, SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { systemClock, systemId } from '@daisy/clock';
import { CLIENT_IP_HEADER } from '../src/features/auth/client-ip';
import { createApp } from '../src/server/app';
import { createRoutes } from '../src/server/routes';

/**
 * Shared harness for suites that drive the REAL route handlers
 * (`/api/auth/[...all]`, `/auth/confirm`, the Resend webhook) against real
 * PostgreSQL and Redis. Each suite builds its own app with `createTestApp`:
 * its own validated environment, Redis namespace, mailbox, log output and
 * client addresses, so no suite depends on which others ran first. Only the
 * outbound mail transport is substituted: the production Resend sender runs
 * unchanged and its HTTP call lands on the suite's mailbox `fetch`.
 */

export const testDatabaseUrl = process.env.TEST_DATABASE_URL;
export const testRedisUrl = process.env.TEST_REDIS_URL;
if (!testDatabaseUrl)
  throw new Error(
    'TEST_DATABASE_URL required; never use application database for tests',
  );
if (!new URL(testDatabaseUrl).pathname.endsWith('_test'))
  throw new Error('Test database name must end in _test');
if (!testRedisUrl) throw new Error('TEST_REDIS_URL required');

export const origin = 'http://localhost:3000';
export const webhookSecret = `whsec_${Buffer.from(createId() + createId()).toString('base64')}`;

export type CapturedMail = {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  readonly idempotencyKey: string;
  readonly messageId: string;
};

/**
 * A private mailbox: its `fetch` answers the Resend endpoint by capturing
 * what the production sender puts on the wire, and passes anything else to
 * the network. Nothing process-wide is replaced.
 */
function createMailbox() {
  const mails: CapturedMail[] = [];
  const failures: Array<'transient' | 'permanent'> = [];
  const runId = createId().slice(0, 8);
  let counter = 0;
  const mailboxFetch = async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== 'https://api.resend.com/emails') return fetch(input, init);
    const failure = failures.shift();
    if (failure === 'transient')
      return new Response('{"message":"upstream boom for someone@x.test"}', {
        status: 503,
      });
    if (failure === 'permanent') return new Response('{}', { status: 422 });
    const body = JSON.parse(String(init?.body)) as {
      to: string[];
      subject: string;
      text: string;
      html: string;
    };
    counter += 1;
    const messageId = `msg_${runId}_${counter}`;
    mails.push({
      to: body.to[0] ?? '',
      subject: body.subject,
      text: body.text,
      html: body.html,
      idempotencyKey: new Headers(init?.headers).get('idempotency-key') ?? '',
      messageId,
    });
    return Response.json({ id: messageId });
  };
  return {
    mails,
    fetch: mailboxFetch,
    failNext: (...kinds: Array<'transient' | 'permanent'>) =>
      failures.push(...kinds),
  };
}

// 198.18.0.0/15 (RFC 2544, benchmarking): 131,070 usable addresses.
const CLIENT_SPACE = 2 ** 17 - 2;

/**
 * Fresh client identities, as the ingress would stamp them, from the
 * benchmarking range. Each call is a new address; the sequence refuses to
 * repeat rather than wrap into an address a rate limit already counted.
 */
function createClients() {
  let issued = 0;
  return () => {
    issued += 1;
    if (issued > CLIENT_SPACE)
      throw new Error('Client address space exhausted for this suite');
    return `198.${18 + (issued >> 16)}.${(issued >> 8) & 255}.${issued & 255}`;
  };
}

/** Runs `work` on a short-lived client with a namespace's key list. */
async function withNamespaceKeys<T>(
  namespace: string,
  work: (client: RedisClient, keys: string[]) => Promise<T>,
) {
  const client = new RedisClient(testRedisUrl as string);
  try {
    const keys = (await client.send('KEYS', [`${namespace}:*`])) as string[];
    return await work(client, keys);
  } finally {
    client.close();
  }
}

/**
 * One suite's own application: `createApp` over the test services with a
 * fresh Redis namespace and a private mailbox, the route handlers built from
 * it, and request builders stamping this suite's own client addresses.
 * Pass environment overrides (an https PUBLIC_APP_URL, the foundation
 * proof flag) to vary the app. Closes itself after the suite.
 */
export function createTestApp(
  overrides: Readonly<Record<string, string | undefined>> = {},
) {
  // Real Postgres/Redis and hundreds of concurrent requests: allow shared CI
  // machines headroom instead of a 5s default that fails on contention alone.
  setDefaultTimeout(30_000);
  const redisNamespace = `t3-${createId().slice(0, 10)}`;
  const env = {
    NODE_ENV: 'test',
    DATABASE_URL: testDatabaseUrl,
    REDIS_URL: testRedisUrl,
    REDIS_NAMESPACE: redisNamespace,
    PUBLIC_APP_URL: origin,
    LOG_LEVEL: 'info',
    BETTER_AUTH_SECRET:
      '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    RESEND_API_KEY: 're_integration_000000000000',
    AUTH_EMAIL_FROM: 'Daisy <no-reply@daisy.example.com>',
    RESEND_WEBHOOK_SECRET: webhookSecret,
    ...overrides,
  };
  const appOrigin = env.PUBLIC_APP_URL ?? origin;
  const mailbox = createMailbox();
  // The suite's log output: kept for assertions, never printed.
  const logLines: string[] = [];
  const app = createApp({
    env,
    fetch: mailbox.fetch,
    clock: systemClock,
    ids: systemId,
    logDestination: { write: (line) => logLines.push(line) },
  });
  const newClient = createClients();
  const jsonPost = (
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    new Request(`${appOrigin}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: appOrigin,
        [CLIENT_IP_HEADER]: newClient(),
        ...headers,
      },
      body: JSON.stringify(body),
    });
  const formPost = (
    fields: Record<string, string>,
    headers: Record<string, string> = {},
  ) =>
    new Request(`${appOrigin}/auth/confirm`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin: appOrigin,
        [CLIENT_IP_HEADER]: newClient(),
        ...headers,
      },
      body: new URLSearchParams(fields).toString(),
    });
  /** Removes exactly the keys this suite created in its own namespace. */
  const clearRedisNamespace = () =>
    withNamespaceKeys(redisNamespace, async (client, keys) => {
      for (const key of keys) await client.del(key);
    });
  const redisKeys = () =>
    withNamespaceKeys(redisNamespace, (client, keys) =>
      Promise.all(
        keys.map(async (key) => ({
          key,
          ttlMs: Number(await client.send('PTTL', [key])),
        })),
      ),
    );
  /**
   * Every log record this app emitted while `work` ran (its own logger and
   * every child), parsed from the real, redacted output.
   */
  const recordLogs = async <T>(
    work: () => Promise<T>,
  ): Promise<{
    readonly result: T;
    readonly records: ReadonlyArray<Record<string, unknown>>;
  }> => {
    const from = logLines.length;
    const result = await work();
    return {
      result,
      records: logLines
        .slice(from)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
    };
  };
  /** The event names this app logged while `run` ran. */
  const withLoggedEvents = async <T>(
    run: () => Promise<T>,
  ): Promise<{ readonly result: T; readonly events: readonly string[] }> => {
    const { result, records } = await recordLogs(run);
    return { result, events: records.map((record) => String(record.event)) };
  };
  afterAll(async () => {
    await clearRedisNamespace();
    await app.close();
  });
  return {
    app,
    routes: createRoutes(app),
    env,
    origin: appOrigin,
    mailbox,
    redisNamespace,
    newClient,
    jsonPost,
    formPost,
    clearRedisNamespace,
    redisKeys,
    recordLogs,
    withLoggedEvents,
  };
}

export type TestApp = ReturnType<typeof createTestApp>;

export const linkFrom = (mail: CapturedMail) => {
  const found = mail.text.match(/https?:\/\/\S+/)?.[0];
  if (!found) throw new Error('No link in captured mail');
  return new URL(found);
};

export const cookieHeader = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');

export const fixtureEmail = () => `auth-${createId()}@example.test`;

export async function withSql<T>(work: (sql: SQL) => Promise<T>): Promise<T> {
  const sql = new SQL(testDatabaseUrl as string);
  try {
    return await work(sql);
  } finally {
    await sql.close();
  }
}

export const counts = (email: string) =>
  withSql(async (sql) => {
    const [users] =
      await sql`SELECT count(*)::int AS c FROM users WHERE email = ${email}`;
    const [sessions] =
      await sql`SELECT count(*)::int AS c FROM session s JOIN users u ON u.id = s.user_id WHERE u.email = ${email}`;
    const [verifications] =
      await sql`SELECT count(*)::int AS c FROM verification WHERE value LIKE ${`%${email}%`}`;
    return {
      users: users?.c as number,
      sessions: sessions?.c as number,
      verifications: verifications?.c as number,
    };
  });

export const removeAccount = (email: string) =>
  withSql(async (sql) => {
    // A completed username claim provisions this account's human actor
    // (ACTOR-1, ADR 0029); actors.user_id is RESTRICT, so it must go before
    // the user row or teardown fails on whichever fixture claimed a name.
    await sql`DELETE FROM actors WHERE user_id IN (SELECT id FROM users WHERE email = ${email})`;
    await sql`DELETE FROM users WHERE email = ${email}`;
    await sql`DELETE FROM verification WHERE value LIKE ${`%${email}%`}`;
  });
