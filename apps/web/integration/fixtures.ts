import { afterAll, setDefaultTimeout } from 'bun:test';
import { RedisClient, SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { systemClock, systemId } from '@daisy/clock';
import { CLIENT_IP_HEADER } from '../src/features/auth/client-ip';
import { createApp } from '../src/server/app';
import { createRoutes } from '../src/server/routes';
import { authTestEnv } from '../src/features/auth/auth-server.test-support';
import { resendRequest } from '../src/features/auth/resend-capture.test-support';

/**
 * The one fixture module for the web integration suites (ISSUE-11): the
 * test environment, the app a suite builds for itself, the accounts it
 * creates, their cleanup and their row counts. Suites that drive the REAL
 * route handlers (`/api/auth/[...all]`, `/auth/confirm`, the Resend webhook)
 * build their own app with `createTestApp`: its own validated environment,
 * Redis namespace, mailbox, log output and client addresses, so no suite
 * depends on which others ran first. Only the outbound mail transport is
 * substituted: the production Resend sender runs unchanged and its HTTP call
 * lands on the suite's mailbox `fetch`. Suites that exercise the Better Auth
 * persistence seams directly build `auth-server-harness.ts`'s server over
 * the same `authTestEnv`.
 */

export const { databaseUrl: testDatabaseUrl, redisUrl: testRedisUrl } =
  requireTestServices(process.env);

export const origin = authTestEnv.PUBLIC_APP_URL;
export const webhookSecret = `whsec_${Buffer.from(createId() + createId()).toString('base64')}`;

type CapturedMail = {
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
    const sent = resendRequest(input, init);
    if (!sent) return fetch(input, init);
    const failure = failures.shift();
    if (failure === 'transient')
      return new Response('{"message":"upstream boom for someone@x.test"}', {
        status: 503,
      });
    if (failure === 'permanent') return new Response('{}', { status: 422 });
    counter += 1;
    const messageId = `msg_${runId}_${counter}`;
    mails.push({ ...sent, messageId });
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
    ...authTestEnv,
    DATABASE_URL: testDatabaseUrl,
    REDIS_URL: testRedisUrl,
    REDIS_NAMESPACE: redisNamespace,
    LOG_LEVEL: 'info',
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
  // Every account this suite created, by its first email and, once known,
  // its user id: an email change mid-test leaves the id as the only key.
  const accounts: Array<{ email: string; userId?: string }> = [];
  /** A unique address whose account is removed after the suite. */
  const freshEmail = () => {
    const email = fixtureEmail();
    accounts.push({ email });
    return email;
  };
  /**
   * Keys every tracked account that now has a user by its id too, in one
   * query, so a later email change cannot orphan it.
   */
  const recordAccountIds = async () => {
    const pending = accounts.filter((account) => !account.userId);
    if (pending.length === 0) return;
    const rows = await withSql(
      (sql) =>
        sql`SELECT id, email FROM users WHERE email = ANY(${sql.array(
          pending.map(({ email }) => email),
          'text',
        )}::text[])`,
    );
    for (const { id, email } of rows as Array<{ id: string; email: string }>) {
      const account = pending.find((entry) => entry.email === email);
      if (account) account.userId = id;
    }
  };
  // One ordered teardown: accounts go while the app's pools are still open,
  // and each step runs even when an earlier one fails (a throwing afterAll
  // skips the hooks after it), so the errors are rethrown together.
  afterAll(async () => {
    const errors: unknown[] = [];
    const step = async (work: () => Promise<unknown>) => {
      try {
        await work();
      } catch (error) {
        errors.push(error);
      }
    };
    await step(() => removeAccounts(accounts));
    await step(clearRedisNamespace);
    await step(() => app.close());
    if (errors.length > 0)
      throw new AggregateError(errors, 'createTestApp teardown failed');
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
    freshEmail,
    recordAccountIds,
  };
}

export type TestApp = ReturnType<typeof createTestApp>;

/** The link a captured message carries (both mail shapes have `text`). */
export const linkFrom = (mail: { readonly text: string }) => {
  const found = mail.text.match(/https?:\/\/\S+/)?.[0];
  if (!found) throw new Error('No link in captured mail');
  return new URL(found);
};

export const tokenOf = (link: URL) => link.searchParams.get('token') ?? '';

export const cookieHeader = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');

export const fixtureEmail = () => `auth-${createId()}@example.test`;

export const isCuid2 = (value: string) => /^[a-z0-9]{24}$/.test(value);

export async function withSql<T>(work: (sql: SQL) => Promise<T>): Promise<T> {
  const sql = new SQL(testDatabaseUrl);
  try {
    return await work(sql);
  } finally {
    await sql.close();
  }
}

export const userIdOf = (email: string) =>
  withSql((sql) => sql`SELECT id FROM users WHERE email = ${email}`).then(
    (rows) => rows[0]?.id as string | undefined,
  );

export const emailOf = (userId: string) =>
  withSql((sql) => sql`SELECT email FROM users WHERE id = ${userId}`).then(
    (rows) => rows[0]?.email as string | undefined,
  );

/**
 * An account a suite created: its unique email, its user id, or both (an
 * email change mid-test leaves the id as the only key; a fixture user may
 * have no email). An empty key matches nothing.
 */
type Account =
  | string
  | {
      readonly email?: string | null | undefined;
      readonly userId?: string | null | undefined;
    };
const keysOf = (account: Account) => {
  const { email, userId } =
    typeof account === 'string' ? { email: account, userId: null } : account;
  return { email: email || null, userId: userId || null };
};

export type AccountCounts = {
  readonly users: number;
  readonly sessions: number;
  readonly verifications: number;
  readonly passkeys: number;
};

export const emptyCounts: AccountCounts = {
  users: 0,
  sessions: 0,
  verifications: 0,
  passkeys: 0,
};

/**
 * The rows an account holds, counted over one connection. Verification rows
 * are matched by containment of the unique fixture email (strpos, so `_` and
 * `%` in an address are literal), so a payload shape Better Auth later
 * extends still counts as a leftover.
 */
export const counts = (account: Account): Promise<AccountCounts> =>
  withSql(async (sql) => {
    const { email, userId } = keysOf(account);
    const [row] = await sql`
      WITH owned AS (
        SELECT id FROM users WHERE email = ${email} OR id = ${userId}
      )
      SELECT
        (SELECT count(*) FROM owned)::int AS users,
        (SELECT count(*) FROM session WHERE user_id IN (SELECT id FROM owned))::int AS sessions,
        (SELECT count(*) FROM verification WHERE strpos(value, ${email}) > 0)::int AS verifications,
        (SELECT count(*) FROM passkey WHERE user_id IN (SELECT id FROM owned))::int AS passkeys`;
    return row as AccountCounts;
  });

/**
 * Removes exactly these accounts' records over one connection: their actors
 * (actors.user_id is RESTRICT, so they go first), the users (sessions,
 * accounts and passkeys cascade) and the verification rows naming their
 * emails. Never touches unrelated rows.
 */
export const removeAccounts = (accounts: readonly Account[]) =>
  withSql(async (sql) => {
    const keys = accounts.map(keysOf);
    const emails = keys.flatMap(({ email }) => (email ? [email] : []));
    const userIds = keys.flatMap(({ userId }) => (userId ? [userId] : []));
    const owned = sql`SELECT id FROM users WHERE email = ANY(${sql.array(emails, 'text')}::text[]) OR id = ANY(${sql.array(userIds, 'text')}::text[])`;
    await sql`DELETE FROM actors WHERE user_id IN (${owned})`;
    await sql`DELETE FROM users WHERE id IN (${owned})`;
    await sql`DELETE FROM verification USING unnest(${sql.array(emails, 'text')}::text[]) AS fixture(email) WHERE strpos(verification.value, fixture.email) > 0`;
  });

/** Removes exactly one account's records; see `removeAccounts`. */
export const removeAccount = (account: Account) => removeAccounts([account]);
