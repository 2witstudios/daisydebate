import { afterAll } from 'bun:test';
import { createHash } from 'node:crypto';
import { RedisClient } from 'bun';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  clearRedisNamespace,
  configureAppEnvironment,
  fixtureEmail,
  installMailbox,
  jsonPost,
  newClient,
  redisNamespace,
  testRedisUrl,
} from './auth-mounted-helpers';
import { closeExtraInstances, secondInstance, statuses } from './auth-rate-limit-helpers';
import { CLIENT_IP_HEADER } from '../src/features/auth/client-ip';

if (!process.env.TEST_DATABASE_URL || !process.env.TEST_REDIS_URL)
  throw new Error('TEST_DATABASE_URL and TEST_REDIS_URL are required');
setupRitewayBun();
configureAppEnvironment();

const mailbox = installMailbox();
const authRoute = await import('../src/app/api/auth/[...all]/route');

const magicLink = (
  headers: Record<string, string> = {},
  email = fixtureEmail(),
) =>
  authRoute.POST(jsonPost('/api/auth/sign-in/magic-link', { email }, headers));

afterAll(async () => {
  await closeExtraInstances();
  await clearRedisNamespace();
});

// auth-rate-limit.integration.ts's earlier tests each pass a few requests
// through the real, shared global magic-link buckets before their own
// client or recipient bucket denies the rest — realistic, since the
// counter genuinely is shared application-wide. Clearing exactly these two
// keys (the same sha3-256 digest `createAuthRateLimiter` sends to Redis)
// before the global-ceiling test below isolates it from that leftover,
// without touching any other test's already-asserted key.
async function clearGlobalMagicLinkBuckets() {
  const client = new RedisClient(testRedisUrl as string);
  try {
    for (const logicalKey of [
      'auth:magic-link:global:60',
      'auth:magic-link:global:86400',
    ])
      await client.del(
        `${redisNamespace}:v1:rl:${createHash('sha3-256').update(logicalKey).digest('hex')}`,
      );
  } finally {
    client.close();
  }
}

describe('ISSUE-5 AC4 per-recipient and global mail-volume ceilings', () => {
  test('one recipient across many clients exceeds the hour ceiling once the minute window is out of the way', async () => {
    // The minute window (3/60s) is the binding constraint for any burst
    // within the same instant, so it must be exhausted and moved past
    // before the hour ceiling (10/h) can be the one that denies. A fake
    // sub-limiter lets the minute bucket's real Redis verdict decide as
    // usual while pinning only the hour bucket's decision, so the gate's
    // handling of a real recipient-hour denial is proven end to end without
    // requiring an hour of real wall-clock time between requests.
    const email = fixtureEmail();
    let hourDenials = 0;
    const server = secondInstance({
      limiter: (base) => ({
        consume: (key, rule) => {
          const isRecipientBucket = key.startsWith(
            'auth:magic-link:recipient:',
          );
          // Bypass the real minute recipient window so the burst can reach
          // the hour bucket without the (already separately proven) minute
          // ceiling denying first; the client, day and global buckets stay
          // real, since only ten single-client, single-recipient requests
          // never come close to their real thresholds.
          if (isRecipientBucket && rule.windowSeconds === 60)
            return Promise.resolve({ allowed: true, retryAfterSeconds: 0 });
          if (isRecipientBucket && rule.windowSeconds === 3_600) {
            hourDenials += 1;
            return Promise.resolve({
              allowed: hourDenials <= 10,
              retryAfterSeconds: 3_600,
            });
          }
          return base.consume(key, rule);
        },
      }),
    });
    const responses: Response[] = [];
    for (let index = 0; index < 11; index += 1)
      responses.push(
        await server.handlers.POST(
          jsonPost(
            '/api/auth/sign-in/magic-link',
            { email },
            { [CLIENT_IP_HEADER]: newClient() },
          ),
        ),
      );
    assert({
      given:
        'eleven sequential requests for one recipient, each from a distinct client, with the hour bucket pinned to allow exactly ten',
      should:
        'admit the first ten and deny the eleventh once the hour ceiling is reached',
      actual: statuses(responses),
      expected: { 200: 10, 429: 1 },
    });
  });

  test('the global per-minute ceiling denies once 120 distinct recipients have sent this minute', async () => {
    await clearGlobalMagicLinkBuckets();
    const before = mailbox.mails.length;
    const responses = await Promise.all(
      Array.from({ length: 121 }, () =>
        magicLink({ [CLIENT_IP_HEADER]: newClient() }, fixtureEmail()),
      ),
    );
    assert({
      given:
        '121 simultaneous magic-link requests, each its own client and recipient',
      should:
        'admit exactly 120 (the global per-minute ceiling) and deny the rest, independent of any single client or recipient bucket',
      actual: {
        tally: statuses(responses),
        mails: mailbox.mails.length - before,
      },
      expected: { tally: { 200: 120, 429: 1 }, mails: 120 },
    });
  });
});
