import { RedisClient } from 'bun';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { clearAuthRateLimits } from '@daisy/redis/namespaces';
import { createAccountFlows } from './auth-account-helpers';
import { testRedisUrl } from './fixtures';

requireTestServices(process.env);
setupRitewayBun();

/**
 * AUTH-7.6 AC1: the post-restore step a restored database's operator runs
 * before it takes traffic. Proves the real path — a real sign-in through
 * the mounted routes, a real session cookie, `database.purgeAllForRestore`
 * and `clearAuthRateLimits` run exactly as the restore runbook and
 * `scripts/post-restore-invalidate.ts` run them, then the same cookie
 * replayed against the real `identify` seam — rather than asserting a row
 * count alone.
 */
describe('AUTH-7.6 post-restore invalidation', () => {
  test('a pre-restore session cookie authenticates before the step and not after', async () => {
    const { flows, identifyAs, signUp } = createAccountFlows();
    const { app, redisNamespace } = flows.testApp;
    const { cookie } = await signUp();

    const before = await identifyAs(cookie);

    const purged = await app.database.purgeAllForRestore();
    const rawRedis = new RedisClient(testRedisUrl as string);
    let clearedRateLimits: number;
    try {
      clearedRateLimits = await clearAuthRateLimits(rawRedis, redisNamespace);
    } finally {
      rawRedis.close();
    }

    const after = await identifyAs(cookie);

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
      given: 'the same pre-restore session cookie replayed after the step',
      should: 'no longer authenticate',
      actual: after.state,
      expected: 'anonymous',
    });
    assert({
      given: 'clearAuthRateLimits run against this suite’s namespace',
      should: 'complete without throwing, whatever counters existed',
      actual: typeof clearedRateLimits,
      expected: 'number',
    });
  });
});
