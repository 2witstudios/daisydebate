import { resolve } from 'node:path';
import { createId } from '@paralleldrive/cuid2';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import nextConfig from '../next.config';
import {
  createRetentionSweep,
  retentionTargets,
} from '../src/server/retention-sweep';
import { createFaultedApp } from './fault-proxy';
import { createTestApp } from './fixtures';

requireTestServices(process.env);
setupRitewayBun();

const REPOSITORY_ROOT = resolve(import.meta.dir, '../../..');
const opsToken = `ops-${createId()}${createId()}`;

/**
 * Next's response headers as production serves them (`next.config.ts`):
 * the stand-in origin below routes to the real handlers without Next, and
 * the probe's origin check reads these headers.
 */
async function productionHeaders(): Promise<Headers> {
  const [everyPath] = (await nextConfig.headers?.()) ?? [];
  const headers = new Headers(
    everyPath?.headers.map(({ key, value }) => [key, value]),
  );
  // next.config.ts adds this entry only when NODE_ENV is production.
  headers.set(
    'Strict-Transport-Security',
    'max-age=31536000; includeSubDomains',
  );
  return headers;
}

/**
 * The real probe CLI, as the scheduled workflow runs it, against `origin`.
 * Asynchronous: the origin is served from this process, so a blocking spawn
 * would leave it unable to answer.
 */
async function runProbe(origin: string) {
  const probe = Bun.spawn(
    ['bun', 'scripts/auth-alert-probe.ts', '--origin', origin],
    {
      cwd: REPOSITORY_ROOT,
      // No Incidents webhook: a probe that decides to post prints its
      // message and then fails to deliver it, which this suite reads.
      env: { PATH: process.env.PATH ?? '', OPS_PROBE_TOKEN: opsToken },
      stdout: 'pipe',
      stderr: 'pipe',
    },
  );
  const [stdout] = await Promise.all([
    new Response(probe.stdout).text(),
    probe.exited,
  ]);
  return stdout;
}

/**
 * ISSUE-199: with Redis unreachable to the instance answering
 * `/api/ops/alerts` but readiness still passing (a GET failure while PING
 * passes, or an instance that never saw the limiter fail), the endpoint
 * answers 200 with no condition and `redisState: "unreachable"`. The probe
 * must post that, not report healthy.
 */
describe('ISSUE-199 the probe over an unreadable alert state', () => {
  const testApp = createTestApp({ OPS_PROBE_TOKEN: opsToken });
  const faulted = createFaultedApp(testApp, 'REDIS_URL');

  test('a healthy origin with an unreadable alert state posts the conditions it did not evaluate', async () => {
    // A completed sweep, so the readable state fires nothing (no cleanup_missed).
    await createRetentionSweep({
      targets: retentionTargets({
        database: testApp.app.database,
        redis: testApp.app.redis,
      }),
      clock: testApp.app.clock,
      logger: testApp.app.logger,
    }).run();
    const headers = await productionHeaders();
    using origin = Bun.serve({
      port: 0,
      fetch: async (request) => {
        const path = new URL(request.url).pathname;
        const response =
          path === '/api/health/ready'
            ? await testApp.routes.ready.GET(request)
            : path === '/api/ops/alerts'
              ? await faulted.routes.ops.alerts.GET(request)
              : new Response(null, { status: 404 });
        headers.forEach((value, key) => response.headers.set(key, value));
        return response;
      },
    });
    const originUrl = `http://127.0.0.1:${origin.port}`;
    const beforeOutage = await runProbe(originUrl);
    faulted.proxy.pause();
    const duringOutage = await runProbe(originUrl);
    faulted.proxy.resume();
    assert({
      given:
        "the real probe CLI against a healthy readiness, before and while the alerts instance's Redis is paused",
      should:
        'report healthy before, then post that the Redis-backed conditions were not evaluated',
      actual: {
        beforeHealthy: beforeOutage.includes('healthy, nothing to report'),
        duringHealthy: duringOutage.includes('healthy, nothing to report'),
        duringNamesUnread: duringOutage.includes('alert state unread'),
        duringNamesOrigin: duringOutage.includes('origin_probe: readiness'),
      },
      expected: {
        beforeHealthy: true,
        duringHealthy: false,
        duringNamesUnread: true,
        duringNamesOrigin: false,
      },
    });
  });
});
