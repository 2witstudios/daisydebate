import { createId } from '@paralleldrive/cuid2';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { systemClock } from '@daisy/clock';
import { requireTestServices } from '@daisy/config';
import {
  createRetentionSweep,
  retentionTargets,
} from '../src/server/retention-sweep';
import { createFaultedApp } from './fault-proxy';
import { cookieHeader, createTestApp, linkFrom, tokenOf } from './fixtures';
import { sampleOf, serveEdge } from './ops-edge';

/**
 * ISSUE-190: every AUTH-7.7 signal `withAlertRecording` derives from the
 * logger, proven through the composition start.ts runs (`createApp`'s
 * logger, `createProductionServer`, the real route handlers or the real
 * retention sweep) rather than by calling a recorder directly. The HTTP
 * counters and the latency histogram are in
 * `auth-alert-counters.integration.ts`; this suite covers the rest.
 */
requireTestServices(process.env);
setupRitewayBun();

const opsToken = `ops-${createId()}${createId()}`;

describe('ISSUE-190 mail delivery failure signals', () => {
  const { app, routes, mailbox, freshEmail } = createTestApp({
    OPS_PROBE_TOKEN: opsToken,
  });

  test('each failed send counts once and the next delivered send resets the consecutive count', async () => {
    const edge = await serveEdge({ app, routes, opsToken });
    try {
      const magicLink = () =>
        edge.post('/api/auth/sign-in/magic-link', { email: freshEmail() });
      mailbox.failNext('permanent', 'permanent');
      const failedStatuses = [await magicLink(), await magicLink()];
      const afterFailures = {
        total: sampleOf(
          await edge.metricsText(),
          'auth_mail_delivery_failures_total',
        ),
        consecutive: (await edge.alertSnapshot()).deliveryConsecutiveFailures,
      };
      const deliveredStatus = await magicLink();
      const afterDelivery = {
        total: sampleOf(
          await edge.metricsText(),
          'auth_mail_delivery_failures_total',
        ),
        consecutive: (await edge.alertSnapshot()).deliveryConsecutiveFailures,
      };
      assert({
        given:
          'two real magic-link requests through the production server whose provider rejects the send, then one it accepts',
        should:
          'count 2 mail delivery failures on /api/ops/metrics and 2 consecutive failures on /api/ops/alerts, then keep the total and reset the consecutive count',
        actual: {
          failedStatuses,
          afterFailures,
          deliveredStatus,
          afterDelivery,
        },
        expected: {
          failedStatuses: [503, 503],
          afterFailures: { total: 2, consecutive: 2 },
          deliveredStatus: 200,
          afterDelivery: { total: 2, consecutive: 0 },
        },
      });
    } finally {
      await edge.close();
    }
  });
});

/**
 * Only the in-process counter can prove this outage: the alert recorder's
 * `limiterUnavailableSinceIso` marker goes to the same unreachable Redis
 * and is lost (ISSUE-191).
 */
describe('ISSUE-190 rate limiter unavailable signals', () => {
  const testApp = createTestApp({ OPS_PROBE_TOKEN: opsToken });
  const {
    app,
    routes,
    proxy: redisProxy,
  } = createFaultedApp(testApp, 'REDIS_URL');

  test('a limiter outage counts each refused request once on /api/ops/metrics', async () => {
    const edge = await serveEdge({ app, routes, opsToken });
    try {
      const magicLink = () =>
        edge.post('/api/auth/sign-in/magic-link', {
          email: testApp.freshEmail(),
        });
      const baselineStatus = await magicLink();
      redisProxy.pause();
      const outageStatuses = [await magicLink(), await magicLink()];
      const text = await edge.metricsText();
      assert({
        given:
          'one admitted magic-link request, then two through the production server while the rate limiter Redis is unreachable',
        should:
          'refuse both with 503 and count 2 in auth_rate_limit_unavailable_total and 2 more 5xx in auth_http_requests_total',
        actual: {
          baselineStatus,
          outageStatuses,
          unavailable: sampleOf(text, 'auth_rate_limit_unavailable_total'),
          serverErrors: sampleOf(
            text,
            'auth_http_requests_total{status_class="5xx"}',
          ),
        },
        expected: {
          baselineStatus: 200,
          outageStatuses: [503, 503],
          unavailable: 2,
          serverErrors: 2,
        },
      });
    } finally {
      redisProxy.resume();
      await edge.close();
    }
  });
});

describe('ISSUE-190 storage unavailable and retention signals', () => {
  const testApp = createTestApp({ OPS_PROBE_TOKEN: opsToken });
  const {
    app,
    routes,
    proxy: dbProxy,
  } = createFaultedApp(testApp, 'DATABASE_URL');

  test('a session read during a database outage marks storage unavailable on /api/ops/alerts', async () => {
    // A real session, signed in while the database is reachable.
    await routes.auth.POST(
      testApp.jsonPost('/api/auth/sign-in/magic-link', {
        email: testApp.freshEmail(),
      }),
    );
    const signedIn = await routes.confirm.POST(
      testApp.formPost({
        token: tokenOf(linkFrom(testApp.mailbox.mails.at(-1)!)),
        callbackURL: '/lobby',
      }),
    );
    const cookie = cookieHeader(signedIn);
    const edge = await serveEdge({ app, routes, opsToken });
    try {
      const before = await edge.alertSnapshot();
      const outageFrom = systemClock.now();
      dbProxy.pause();
      const ticketStatus = await edge.post(
        '/api/realtime/ticket',
        {},
        { cookie },
      );
      const since = (await edge.alertSnapshot()).storageUnavailableSinceIso;
      const outageTo = systemClock.now();
      assert({
        given:
          'a signed-in realtime ticket request through the production server while the session database is unreachable',
        should:
          'refuse it with 503 and record when storage became unavailable on /api/ops/alerts',
        actual: {
          before: before.storageUnavailableSinceIso,
          ticketStatus,
          sinceWithinOutage:
            since !== null && since >= outageFrom && since <= outageTo,
        },
        expected: { before: null, ticketStatus: 503, sinceWithinOutage: true },
      });
    } finally {
      dbProxy.resume();
      await edge.close();
    }
  });

  test('a retention sweep during a database outage counts each failed target and records its successful one', async () => {
    const edge = await serveEdge({ app, routes, opsToken });
    const sweep = createRetentionSweep({
      targets: retentionTargets({
        database: app.database,
        redis: app.redis,
      }),
      clock: app.clock,
      logger: app.logger,
    });
    try {
      const before = await edge.alertSnapshot();
      const sweptFrom = systemClock.now();
      dbProxy.pause();
      const results = await sweep.run();
      const sweptTo = systemClock.now();
      const text = await edge.metricsText();
      const lastSuccess = (await edge.alertSnapshot()).retentionLastSuccessIso;
      const failed = results
        .filter((result) => !result.ok)
        .map((result) => result.operation);
      assert({
        given:
          "the real retention sweep over the app's logger while PostgreSQL is unreachable and Redis is not",
        should:
          'count one retention_sweep_failures_total per database target and record the Redis target success on /api/ops/alerts',
        actual: {
          before: before.retentionLastSuccessIso,
          failed,
          failuresByTarget: failed.map((operation) =>
            sampleOf(
              text,
              `retention_sweep_failures_total{operation="${operation}"}`,
            ),
          ),
          lastSuccessWithinSweep:
            lastSuccess !== null &&
            lastSuccess >= sweptFrom &&
            lastSuccess <= sweptTo,
        },
        expected: {
          before: null,
          failed: [
            'retention.verification',
            'retention.outbox',
            'retention.session',
            'retention.email_delivery_event',
            'retention.email_delivery',
          ],
          failuresByTarget: [1, 1, 1, 1, 1],
          lastSuccessWithinSweep: true,
        },
      });
    } finally {
      dbProxy.resume();
      await edge.close();
    }
    // Five database targets, each failing only once its connection attempt
    // through the paused proxy gives up (about 3 s apiece locally).
  }, 60_000);
});
