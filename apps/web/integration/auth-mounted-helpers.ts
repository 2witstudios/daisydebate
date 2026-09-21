import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { createHash } from 'node:crypto';
import { CLIENT_IP_HEADER } from '../src/features/auth/client-ip';

/**
 * Shared harness for suites that drive the REAL mounted route modules
 * (`/api/auth/[...all]`, `/auth/confirm`, the Resend webhook) against real
 * PostgreSQL and Redis. Only the outbound mail transport is substituted: the
 * production Resend sender runs unchanged and its HTTP call is captured.
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
export const redisNamespace = `t3-${createId().slice(0, 10)}`;

export const configureAppEnvironment = () => {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: testDatabaseUrl,
    REDIS_URL: testRedisUrl,
    REDIS_NAMESPACE: redisNamespace,
    PUBLIC_APP_URL: origin,
    LOG_LEVEL: 'silent',
    BETTER_AUTH_SECRET:
      '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
    RESEND_API_KEY: 're_integration_000000000000',
    AUTH_EMAIL_FROM: 'Daisy <no-reply@daisy.example.com>',
    RESEND_WEBHOOK_SECRET: webhookSecret,
  });
};

export type CapturedMail = {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
  readonly idempotencyKey: string;
  readonly messageId: string;
};

let sharedMailbox: ReturnType<typeof createMailbox> | undefined;
/**
 * `bun test` loads every suite before running any, so exactly one mailbox may
 * wrap `fetch` for the whole process; suites share it and read only mail
 * emitted after their own request (index arithmetic on `mails`).
 */
export const installMailbox = () => (sharedMailbox ??= createMailbox());

/** Private mailbox: captures only what the production sender puts on the wire. */
function createMailbox() {
  const mails: CapturedMail[] = [];
  const failures: Array<'transient' | 'permanent'> = [];
  const real = globalThis.fetch;
  const runId = createId().slice(0, 8);
  let counter = 0;
  globalThis.fetch = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url !== 'https://api.resend.com/emails') return real(input, init);
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
  }) as typeof fetch;
  return {
    mails,
    failNext: (...kinds: Array<'transient' | 'permanent'>) =>
      failures.push(...kinds),
  };
}

export const linkFrom = (mail: CapturedMail) => {
  const found = mail.text.match(/https?:\/\/\S+/)?.[0];
  if (!found) throw new Error('No link in captured mail');
  return new URL(found);
};

let clientCounter = 0;
/** A fresh documentation-range client identity, as the ingress would stamp. */
export const newClient = () =>
  `198.51.100.${(clientCounter = (clientCounter % 250) + 1)}`;

export const jsonPost = (
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) =>
  new Request(`${origin}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      [CLIENT_IP_HEADER]: newClient(),
      ...headers,
    },
    body: JSON.stringify(body),
  });

export const formPost = (
  fields: Record<string, string>,
  headers: Record<string, string> = {},
) =>
  new Request(`${origin}/auth/confirm`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      origin,
      [CLIENT_IP_HEADER]: newClient(),
      ...headers,
    },
    body: new URLSearchParams(fields).toString(),
  });

export const cookieHeader = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');

export const fixtureEmail = () => `auth-${createId()}@example.test`;

export const sha3 = (value: string) =>
  createHash('sha3-256').update(value).digest('hex');

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
    await sql`DELETE FROM users WHERE email = ${email}`;
    await sql`DELETE FROM verification WHERE value LIKE ${`%${email}%`}`;
  });

/** Removes exactly the rate-limit keys this run created in its own namespace. */
export async function clearRedisNamespace() {
  const { RedisClient } = await import('bun');
  const client = new RedisClient(testRedisUrl as string);
  try {
    const keys = (await client.send('KEYS', [
      `${redisNamespace}:*`,
    ])) as string[];
    for (const key of keys) await client.del(key);
  } finally {
    client.close();
  }
}

export async function redisKeys() {
  const { RedisClient } = await import('bun');
  const client = new RedisClient(testRedisUrl as string);
  try {
    const keys = (await client.send('KEYS', [
      `${redisNamespace}:*`,
    ])) as string[];
    const withTtl = await Promise.all(
      keys.map(async (key) => ({
        key,
        ttlMs: Number(await client.send('PTTL', [key])),
      })),
    );
    return withTtl;
  } finally {
    client.close();
  }
}
