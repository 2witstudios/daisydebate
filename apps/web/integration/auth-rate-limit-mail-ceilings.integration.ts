import { afterAll } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createTestApp, fixtureEmail } from './auth-mounted-helpers';
import { createSecondInstances, statuses } from './auth-rate-limit-helpers';
import { CLIENT_IP_HEADER } from '../src/features/auth/client-ip';
import { requireTestServices } from '@daisy/config';

requireTestServices(process.env);
setupRitewayBun();

// Each ceiling gets its own app, so each starts from empty buckets: the
// global ceiling is application-wide, and ten admitted hour-ceiling requests
// would otherwise count against it in whichever order the tests run.
const hourApp = createTestApp();
const { secondInstance, closeExtraInstances } = createSecondInstances(hourApp);
const globalApp = createTestApp();

const magicLink = (
  headers: Record<string, string> = {},
  email = fixtureEmail(),
) =>
  globalApp.routes.auth.POST(
    globalApp.jsonPost('/api/auth/sign-in/magic-link', { email }, headers),
  );

afterAll(async () => {
  await closeExtraInstances();
});

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
          hourApp.jsonPost(
            '/api/auth/sign-in/magic-link',
            { email },
            { [CLIENT_IP_HEADER]: hourApp.newClient() },
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
