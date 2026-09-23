import { afterAll } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  createTestApp,
  fixtureEmail,
  removeAccount,
  withSql,
} from './auth-mounted-helpers';
import { CLIENT_IP_HEADER } from '../src/features/auth/client-ip';

setupRitewayBun();
if (!process.env.TEST_DATABASE_URL || !process.env.TEST_REDIS_URL)
  throw new Error('TEST_DATABASE_URL and TEST_REDIS_URL are required');

/**
 * ISSUE-7: two apps built by `createApp` side by side in one process, over
 * the same PostgreSQL and Redis, with different environments. Each request
 * is answered from its own app's configuration, limiter namespace and
 * mailbox, and building them touches no process-wide state.
 */
const envBefore = JSON.stringify(process.env);
const globalsBefore = Object.keys(globalThis).sort();

const open = createTestApp({ FOUNDATION_PROOF_ENABLED: 'true' });
const shut = createTestApp({ FOUNDATION_PROOF_ENABLED: 'false' });

const createdIds: string[] = [];
const emails: string[] = [];
afterAll(async () => {
  await withSql(async (sql) => {
    for (const id of createdIds)
      await sql`DELETE FROM debates WHERE id = ${id}`;
  });
  for (const email of emails) await removeAccount(email);
});

const proofPost = (testApp: typeof open) =>
  testApp.routes.foundationProof.POST(
    new Request(`${testApp.origin}/api/foundation/proof`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: testApp.origin },
      body: JSON.stringify({ resolution: 'Composition root proof' }),
    }),
  );

const magicLink = (testApp: typeof open, client: string, email: string) =>
  testApp.routes.auth.POST(
    testApp.jsonPost(
      '/api/auth/sign-in/magic-link',
      { email },
      { [CLIENT_IP_HEADER]: client },
    ),
  );

describe('ISSUE-7 composition root', () => {
  test('two apps with different flags answer concurrent requests from their own config', async () => {
    const responses = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        proofPost(index % 2 === 0 ? open : shut),
      ),
    );
    for (const response of responses.filter((r) => r.status === 201))
      createdIds.push(((await response.clone().json()) as { id: string }).id);
    assert({
      given:
        'interleaved concurrent proof requests to an app with the gate open and one with it shut',
      should: 'create on the open app every time and refuse on the shut one',
      actual: responses.map((response) => response.status),
      expected: [201, 404, 201, 404, 201, 404],
    });
  });

  test("one app's rate limits and mail never reach the other", async () => {
    const client = '198.51.100.77';
    const openBefore = open.mailbox.mails.length;
    const shutBefore = shut.mailbox.mails.length;
    const email = fixtureEmail();
    emails.push(email);
    const exhausted = [];
    for (let index = 0; index < 4; index += 1)
      exhausted.push((await magicLink(open, client, email)).status);
    const other = fixtureEmail();
    emails.push(other);
    const fromOtherApp = (await magicLink(shut, client, other)).status;
    const openKeys = await open.redisKeys();
    const shutKeys = await shut.redisKeys();
    assert({
      given:
        'one client exhausting its magic-link limit on the first app, then asking the second',
      should:
        "limit it on the first app only, keep each app's keys in its own namespace and deliver each mail to its own mailbox",
      actual: {
        exhausted,
        fromOtherApp,
        openMails: open.mailbox.mails
          .slice(openBefore)
          .map((mail) => mail.to === email),
        shutMails: shut.mailbox.mails
          .slice(shutBefore)
          .map((mail) => mail.to === other),
        namespaces: {
          open: openKeys.every(({ key }) =>
            key.startsWith(`${open.redisNamespace}:`),
          ),
          shut: shutKeys.every(({ key }) =>
            key.startsWith(`${shut.redisNamespace}:`),
          ),
          distinct: open.redisNamespace !== shut.redisNamespace,
        },
      },
      expected: {
        exhausted: [200, 200, 200, 429],
        fromOtherApp: 200,
        openMails: [true, true, true],
        shutMails: [true],
        namespaces: { open: true, shut: true, distinct: true },
      },
    });
  });

  test('building and serving both apps changed no process environment or global', () => {
    assert({
      given: 'two apps built and exercised in this process',
      should: 'leave process.env and the global object exactly as they were',
      actual: {
        env: JSON.stringify(process.env) === envBefore,
        globals: Object.keys(globalThis).sort(),
      },
      expected: { env: true, globals: globalsBefore },
    });
  });
});
