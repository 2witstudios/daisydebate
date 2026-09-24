import { createHash } from 'node:crypto';
import { RedisClient } from 'bun';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { redisKey } from '@daisy/redis';
import {
  createTestApp,
  fixtureEmail,
  type TestApp,
} from './auth-mounted-helpers';
import { statuses } from './auth-rate-limit-helpers';
import { CLIENT_IP_HEADER } from '../src/features/auth/client-ip';
import {
  deriveRecipientSubkey,
  recipientKey as keyRecipient,
} from '../src/features/auth/recipient-key';

if (!process.env.TEST_DATABASE_URL || !process.env.TEST_REDIS_URL)
  throw new Error('TEST_DATABASE_URL and TEST_REDIS_URL are required');
setupRitewayBun();

// Each ceiling gets its own app, so each starts from empty buckets: the
// global ceilings are application-wide, and the admitted requests of one
// test would otherwise count against another in whichever order they run.
const hourApp = createTestApp();
const dayApp = createTestApp();
const globalDayApp = createTestApp();
const globalApp = createTestApp();

/** The limiter's real Redis key for a gate bucket key (`redis-limiter.ts`). */
const limiterKey = (testApp: TestApp, bucket: string) =>
  redisKey(
    testApp.redisNamespace,
    'rl',
    createHash('sha3-256').update(bucket).digest('hex'),
  );

/** A recipient bucket key, as `rate-limit.ts` builds it. */
const recipientKey = (testApp: TestApp, email: string, window: number) =>
  `auth:magic-link:recipient:${keyRecipient(
    deriveRecipientSubkey(String(testApp.env.BETTER_AUTH_SECRET)),
    email,
  )}:${window}`;

/**
 * A fixed window elapsing: its counter key expires in Redis, which is what
 * the limiter's PEXPIRE does when the window ends. Every other bucket keeps
 * its real count, so the ceiling under test is the one that decides.
 */
const elapse = async (testApp: TestApp, ...buckets: string[]) => {
  const client = new RedisClient(String(process.env.TEST_REDIS_URL));
  try {
    for (const bucket of buckets) await client.del(limiterKey(testApp, bucket));
  } finally {
    client.close();
  }
};

const magicLink = (
  headers: Record<string, string> = {},
  email = fixtureEmail(),
) =>
  globalApp.routes.auth.POST(
    globalApp.jsonPost('/api/auth/sign-in/magic-link', { email }, headers),
  );

describe('ISSUE-5 AC4 per-recipient and global mail-volume ceilings', () => {
  test('one recipient across many clients: the real hour ceiling denies the eleventh', async () => {
    const email = fixtureEmail();
    const responses: Response[] = [];
    for (let index = 0; index < 11; index += 1) {
      // The minute window elapses between requests; the hour and day
      // buckets keep their real Redis counts.
      await elapse(hourApp, recipientKey(hourApp, email, 60));
      responses.push(
        await hourApp.routes.auth.POST(
          hourApp.jsonPost(
            '/api/auth/sign-in/magic-link',
            { email },
            { [CLIENT_IP_HEADER]: hourApp.newClient() },
          ),
        ),
      );
    }
    assert({
      given:
        'eleven requests for one recipient from distinct clients, a minute apart, against real Redis',
      should:
        'admit ten (the recipient hour ceiling) and deny the eleventh with an hour-long retry',
      actual: {
        tally: statuses(responses),
        retryAfter: Number(responses.at(-1)?.headers.get('retry-after')) > 60,
      },
      expected: { tally: { 200: 10, 429: 1 }, retryAfter: true },
    });
  });

  test('one recipient across many clients: the real day ceiling denies the twenty-first', async () => {
    const email = fixtureEmail();
    const responses: Response[] = [];
    for (let index = 0; index < 21; index += 1) {
      // Both the minute and the hour windows elapse between requests; only
      // the day bucket keeps counting.
      await elapse(
        dayApp,
        recipientKey(dayApp, email, 60),
        recipientKey(dayApp, email, 3_600),
      );
      responses.push(
        await dayApp.routes.auth.POST(
          dayApp.jsonPost(
            '/api/auth/sign-in/magic-link',
            { email },
            { [CLIENT_IP_HEADER]: dayApp.newClient() },
          ),
        ),
      );
    }
    assert({
      given:
        'twenty-one requests for one recipient from distinct clients, an hour apart, against real Redis',
      should:
        'admit twenty (the recipient day ceiling) and deny the twenty-first with a retry past an hour',
      actual: {
        tally: statuses(responses),
        retryAfter:
          Number(responses.at(-1)?.headers.get('retry-after')) > 3_600,
      },
      expected: { tally: { 200: 20, 429: 1 }, retryAfter: true },
    });
  });

  test('the real global day ceiling denies the 3,001st distinct recipient of the day', async () => {
    const before = globalDayApp.mailbox.mails.length;
    const responses: Response[] = [];
    // 3,001 requests in bursts of 100, each its own client and recipient;
    // the global minute window elapses between bursts.
    for (let sent = 0; sent < 3_001; sent += 100) {
      await elapse(globalDayApp, 'auth:magic-link:global:60');
      responses.push(
        ...(await Promise.all(
          Array.from({ length: Math.min(100, 3_001 - sent) }, () =>
            globalDayApp.routes.auth.POST(
              globalDayApp.jsonPost(
                '/api/auth/sign-in/magic-link',
                { email: fixtureEmail() },
                { [CLIENT_IP_HEADER]: globalDayApp.newClient() },
              ),
            ),
          ),
        )),
      );
    }
    assert({
      given:
        '3,001 magic-link requests over a simulated day, each its own client and recipient, against real Redis',
      should:
        'admit exactly 3,000 (the global day ceiling), deny the rest and mail only the admitted',
      actual: {
        tally: statuses(responses),
        mails: globalDayApp.mailbox.mails.length - before,
      },
      expected: { tally: { 200: 3_000, 429: 1 }, mails: 3_000 },
    });
  }, 180_000);

  test('the global per-minute ceiling denies once 120 distinct recipients have sent this minute', async () => {
    const before = globalApp.mailbox.mails.length;
    const responses = await Promise.all(
      Array.from({ length: 121 }, () =>
        magicLink(
          { [CLIENT_IP_HEADER]: globalApp.newClient() },
          fixtureEmail(),
        ),
      ),
    );
    assert({
      given:
        '121 simultaneous magic-link requests, each its own client and recipient',
      should:
        'admit exactly 120 (the global per-minute ceiling) and deny the rest, independent of any single client or recipient bucket',
      actual: {
        tally: statuses(responses),
        mails: globalApp.mailbox.mails.length - before,
      },
      expected: { tally: { 200: 120, 429: 1 }, mails: 120 },
    });
  });
});
