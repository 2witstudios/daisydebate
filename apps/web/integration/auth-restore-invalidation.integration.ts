import { RedisClient } from 'bun';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { redisKey } from '@daisy/redis';
import { clearAuthRateLimits } from '@daisy/redis/namespaces';
import {
  createAccountFlows,
  emailedLinkRejected,
} from './auth-account-helpers';
import { testRedisUrl } from './fixtures';

requireTestServices(process.env);
setupRitewayBun();

/**
 * AUTH-7.6 AC1: the post-restore step a restored database's operator runs
 * before it takes traffic. Proves the real path for both auth surfaces the
 * criterion names — a real session cookie AND a real, unredeemed magic-link
 * token — plus a real rate-limit key, through `database.purgeAllForRestore`
 * and `clearAuthRateLimits` exactly as the restore runbook and
 * `scripts/post-restore-invalidate.ts` run them, then each artifact replayed
 * against the real seam that would accept it — never a row count alone.
 */
describe('AUTH-7.6 post-restore invalidation', () => {
  test('a pre-restore session cookie, magic-link token and rate-limit key all stop working after the step', async () => {
    const { flows, identifyAs, signUp } = createAccountFlows();
    const { app, redisNamespace } = flows.testApp;
    const { cookie } = await signUp();

    // A second, still-pending sign-in link: requested but never redeemed,
    // exactly the "verification links in flight" the criterion names.
    const pendingEmail = flows.fresh();
    const pendingToken = await flows.linkTokenFor(pendingEmail);

    const rateLimitKey = redisKey(
      redisNamespace,
      'rl',
      'restore-invalidation-proof',
    );
    const rawRedis = new RedisClient(testRedisUrl as string);
    await rawRedis.send('SET', [rateLimitKey, '1', 'EX', '60']);

    const before = await identifyAs(cookie);

    const purged = await app.database.purgeAllForRestore();
    const clearedRateLimitKeys = await clearAuthRateLimits(
      rawRedis,
      redisNamespace,
    );

    const after = await identifyAs(cookie);
    const linkReplay = await flows.redeem(pendingToken);
    const rateLimitKeyStillExists = await rawRedis.exists(rateLimitKey);
    rawRedis.close();

    assert({
      given: 'a real session cookie from the mounted sign-in flow',
      should: 'authenticate as a provisional member before the restore step',
      actual: before.state,
      expected: 'provisional',
    });
    assert({
      given: 'the post-restore step run against the freshly restored copy',
      should: 'delete the session row created by the sign-in',
      actual: purged.sessions >= 1,
      expected: true,
    });
    assert({
      given: 'the post-restore step run while a magic-link request is pending',
      should: 'delete the verification row that request created',
      actual: purged.verifications >= 1,
      expected: true,
    });
    assert({
      given: 'the same pre-restore session cookie replayed after the step',
      should: 'no longer authenticate',
      actual: after.state,
      expected: 'anonymous',
    });
    assert({
      given: 'the pending magic-link token redeemed after the step',
      should: 'be rejected exactly as a replayed/invalid token is',
      actual: emailedLinkRejected(linkReplay),
      expected: true,
    });
    assert({
      given: 'a real rate-limit key set before the step',
      should: 'be reported cleared and be gone from Redis',
      actual: {
        reportedCleared: clearedRateLimitKeys >= 1,
        stillExists: rateLimitKeyStillExists,
      },
      expected: { reportedCleared: true, stillExists: false },
    });
  });
});
