import { createHash } from 'node:crypto';
import { RedisClient } from 'bun';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { ticketSchema } from '@daisy/protocol';
import { createAccountFlows, uniqueName } from './auth-account-helpers';
import { origin, testRedisUrl, withSql } from './fixtures';

if (!process.env.TEST_DATABASE_URL || !process.env.TEST_REDIS_URL)
  throw new Error('TEST_DATABASE_URL and TEST_REDIS_URL are required');
setupRitewayBun();

const { flows, signUp, claim } = createAccountFlows();
const { testApp, jsonPost } = flows;
const ticketRoute = testApp.routes.ticket;

/** A real signed-in member (claimed username, so an actors row exists) through the mounted routes. */
async function memberSession() {
  const { email, cookie } = await signUp();
  const username = uniqueName();
  const claimed = await claim(cookie, { username });
  if (claimed.status !== 201)
    throw new Error(`fixture: claiming a username failed (${claimed.status})`);
  const [row] = (await withSql(
    (sql) => sql`
      SELECT a.id AS "actorId", s.id AS "sessionId"
      FROM users u
      JOIN actors a ON a.user_id = u.id
      JOIN session s ON s.user_id = u.id
      WHERE u.email = ${email}
    `,
  )) as { actorId: string; sessionId: string }[];
  if (!row) throw new Error('fixture: no actor/session row for the new member');
  return { email, cookie, actorId: row.actorId, sessionId: row.sessionId };
}

const postTicket = (cookie: string, headers: Record<string, string> = {}) =>
  ticketRoute.POST(
    jsonPost('/api/realtime/ticket', {}, { cookie, ...headers }),
  );

/** Reads a Redis key's value and TTL through a fresh, short-lived client. */
async function readRedisKey(key: string) {
  const client = new RedisClient(testRedisUrl as string);
  try {
    const [value, ttlMs] = await Promise.all([
      client.get(key),
      client.send('PTTL', [key]).then(Number),
    ]);
    return { value, ttlMs };
  } finally {
    client.close();
  }
}

describe('RT-2.4a POST /api/realtime/ticket through the mounted route', () => {
  test('stores only the ticket hash in Redis, bound to the real actor, session and origin, TTL <= 60s', async () => {
    const { cookie, actorId, sessionId } = await memberSession();

    const response = await postTicket(cookie);
    const body = (await response.json()) as {
      ticket: string;
      expiresInSeconds: number;
    };
    const hash = createHash('sha3-256').update(body.ticket).digest('hex');
    const key = `${testApp.redisNamespace}:v1:ticket:${hash}`;
    const { value: raw, ttlMs } = await readRedisKey(key);
    const binding = raw ? (JSON.parse(raw) as unknown) : null;

    assert({
      given: "a real signed-in member's request over the mounted route",
      should:
        'answer 200 with a 43-char ticket and 60s TTL, and store in Redis only its hash, bound to exactly {actorId, sessionId, origin}, with no plaintext ticket in the key or value',
      actual: {
        status: response.status,
        ticketShapeOk: ticketSchema.safeParse(body.ticket).success,
        expiresInSeconds: body.expiresInSeconds,
        binding,
        ttlWithinBudget: ttlMs > 0 && ttlMs <= 60_000,
        keyContainsPlaintext: key.includes(body.ticket),
        valueContainsPlaintext: raw?.includes(body.ticket) ?? false,
      },
      expected: {
        status: 200,
        ticketShapeOk: true,
        expiresInSeconds: 60,
        binding: { actorId, sessionId, origin },
        ttlWithinBudget: true,
        keyContainsPlaintext: false,
        valueContainsPlaintext: false,
      },
    });
  });

  test('a foreign or missing Origin is refused, with no rate-limit spend and no ticket issued', async () => {
    const { cookie } = await memberSession();
    const ticketKeyCount = async () =>
      (await testApp.redisKeys()).filter(({ key }) =>
        key.includes(':v1:ticket:'),
      ).length;
    // Counted as a delta, not an absolute zero: the suite's own namespace
    // may already hold an unconsumed ticket from an earlier test in this
    // file, which this test must not treat as a failure of its own.
    const before = await ticketKeyCount();

    const foreign = await postTicket(cookie, {
      origin: 'https://attacker.example',
    });
    const foreignBody = (await foreign.json()) as { error: { code: string } };

    const missing = await ticketRoute.POST(
      new Request(`${testApp.origin}/api/realtime/ticket`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie },
        body: '{}',
      }),
    );
    const missingBody = (await missing.json()) as { error: { code: string } };

    const after = await ticketKeyCount();

    assert({
      given:
        'a request whose Origin does not match the app, and one with no Origin at all',
      should:
        'answer 403 AUTHORIZATION for both, before any rate-limit consumption or ticket write',
      actual: {
        foreignStatus: foreign.status,
        foreignCode: foreignBody.error.code,
        missingStatus: missing.status,
        missingCode: missingBody.error.code,
        newTicketKeysIssued: after - before,
      },
      expected: {
        foreignStatus: 403,
        foreignCode: 'AUTHORIZATION',
        missingStatus: 403,
        missingCode: 'AUTHORIZATION',
        newTicketKeysIssued: 0,
      },
    });
  });
});
