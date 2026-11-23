import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import type { AlertSnapshot } from '../src/features/ops/alert-state';
import { createMetricsHandler } from '../src/features/ops/metrics';
import { composeOpsRoutes } from '../src/features/ops/composition';
import { createTestApp } from './fixtures';
import { opsComposition } from '../src/features/ops/composition';

setupRitewayBun();
const token = `ops-${createId()}${createId()}`;
const request = (path: string, bearer?: string) =>
  new Request(`http://localhost${path}`, {
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });

test('Ops feature handlers retain live startup and drain readiness over real services', async () => {
  const f = createTestApp({ OPS_PROBE_TOKEN: token });
  const routes = composeOpsRoutes({
    ...f.app,
    local: f.app.localAlertState,
    token: () => f.app.opsProbeToken(),
    fileMaintenanceIntervalMs: null,
  });
  let release!: () => void;
  const checked = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.app.holdReadinessUntil(checked);
  try {
    const pending = await routes.ready.GET(request('/api/health/ready'));
    release();
    await checked;
    const ready = await routes.ready.GET(request('/api/health/ready'));
    f.app.drain();
    const draining = await routes.ready.GET(request('/api/health/ready'));
    assert({
      given:
        'real healthy PostgreSQL/Redis with a pending startup check, then settled startup, then drain',
      should: 'preserve503→200→503 through the existing readiness handler',
      actual: [
        pending.status,
        await pending.json(),
        ready.status,
        await ready.json(),
        draining.status,
        await draining.json(),
      ],
      expected: [
        503,
        { status: 'unavailable' },
        200,
        { status: 'ready' },
        503,
        { status: 'unavailable' },
      ],
    });
  } finally {
    release();
  }
});

test('Ops binding reads probe authority lazily and retains configured workers and metrics', async () => {
  const f = createTestApp({ OPS_PROBE_TOKEN: token });
  let current = token,
    reads = 0;
  const interval = 3 * 60 * 60 * 1000;
  const routes = composeOpsRoutes({
    ...f.app,
    local: f.app.localAlertState,
    fileMaintenanceIntervalMs: interval,
    token: () => {
      reads += 1;
      return current;
    },
  });
  const atConstruction = reads;
  const denied = await routes.ops.alerts.GET(request('/api/ops/alerts'));
  const alerts = await routes.ops.alerts.GET(request('/api/ops/alerts', token));
  const snapshot = (await alerts.json()) as {
    snapshot: Extract<AlertSnapshot, { redisState: 'read' }>;
  };
  const fileWorker = snapshot.snapshot.workers.find(
    (worker) => worker.name === 'messaging_file_maintenance',
  );
  current = `rotated-${createId()}${createId()}`;
  const stale = await routes.ops.metrics.GET(
    request('/api/ops/metrics', token),
  );
  f.app.metrics.observe('auth.rate_limit.denied', {
    operation: 'auth.magic_link',
  });
  const metrics = await routes.ops.metrics.GET(
    request('/api/ops/metrics', current),
  );
  const text = await metrics.text();
  const baseline = await createMetricsHandler({
    logger: f.app.logger,
    reporter: f.app.reporter,
    metrics: f.app.metrics,
    token: () => current,
  })(request('/api/ops/metrics', current));
  const baselineText = await baseline.text();
  const counter = (body: string) =>
    body
      .split('\n')
      .find((line) => line.startsWith('auth_rate_limit_denied_total '));
  assert({
    given:
      'a lazy token closure rotated after composition, a three-hour file-maintenance interval and a real metrics store',
    should:
      'read authority only per request, retain worker threshold and serve the supplied metrics with the existing content type',
    actual: [
      atConstruction,
      reads,
      denied.status,
      alerts.status,
      stale.status,
      metrics.status,
      fileWorker?.missedAfterMs,
      metrics.headers.get('content-type'),
      counter(text),
      counter(baselineText),
    ],
    expected: [
      0,
      4,
      401,
      200,
      401,
      200,
      3 * interval,
      'text/plain; version=0.0.4; charset=utf-8',
      'auth_rate_limit_denied_total 1',
      'auth_rate_limit_denied_total 1',
    ],
  });
});

test('ordinary central route registration reaches the Ops feature with its original process inputs', async () => {
  const f = createTestApp({ OPS_PROBE_TOKEN: token });
  const ready = await f
    .routes(opsComposition)
    .ready.GET(request('/api/health/ready'));
  const denied = await f
    .routes(opsComposition)
    .ops.metrics.GET(request('/api/ops/metrics'));
  const metrics = await f
    .routes(opsComposition)
    .ops.metrics.GET(request('/api/ops/metrics', token));
  const alerts = await f
    .routes(opsComposition)
    .ops.alerts.GET(request('/api/ops/alerts', token));
  const body = (await alerts.json()) as {
    snapshot: Extract<AlertSnapshot, { redisState: 'read' }>;
  };
  f.app.drain();
  const draining = await f
    .routes(opsComposition)
    .ready.GET(request('/api/health/ready'));
  assert({
    given:
      'the actual createApp and ops composition over real service ports with file maintenance unconfigured',
    should:
      'retain readiness, protected metrics and live alert inputs at the existing route keys',
    actual: [
      ready.status,
      denied.status,
      metrics.status,
      alerts.status,
      body.snapshot.redisState,
      body.snapshot.workers.some(
        (worker) => worker.name === 'messaging_file_maintenance',
      ),
      draining.status,
    ],
    expected: [200, 401, 200, 200, 'read', false, 503],
  });
});
