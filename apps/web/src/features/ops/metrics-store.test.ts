import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  createMetricsStore,
  formatPrometheusMetrics,
  LATENCY_BUCKETS_MS,
} from './metrics-store';

setupRitewayBun();

describe('createMetricsStore (AUTH-7.7)', () => {
  test('buckets auth-operation completions by status class only', () => {
    const store = createMetricsStore();
    store.observe('http.request.completed', {
      operation: 'auth.request',
      status: 200,
    });
    store.observe('http.request.completed', {
      operation: 'auth.request',
      status: 204,
    });
    store.observe('http.request.failed', {
      operation: 'auth.request',
      status: 503,
    });
    store.observe('http.request.completed', {
      operation: 'auth.request',
      status: 429,
    });
    store.observe('http.request.completed', {
      operation: 'health.readiness',
      status: 500,
    });
    assert({
      given: '3 auth 2xx, 1 auth 4xx, 1 auth 5xx, and 1 non-auth 5xx',
      should:
        'count only the auth-prefixed operations, bucketed by status class',
      actual: store.snapshot().httpRequestsByStatusClass,
      expected: { '2xx': 2, '3xx': 0, '4xx': 1, '5xx': 1 },
    });
  });

  test('counts rate-limit and mail-delivery events', () => {
    const store = createMetricsStore();
    store.observe('auth.rate_limit.denied', {});
    store.observe('auth.rate_limit.denied', {});
    store.observe('auth.rate_limit.unavailable', {});
    store.observe('mail.failed', { purpose: 'auth' });
    store.observe('mail.failed', { purpose: 'beta-access' });
    store.observe('mail.failed', { purpose: 'billing' });
    store.observe('mail.shed', { purpose: 'auth', pending: 68 });
    store.observe('mail.shed', { purpose: 'auth', pending: 68 });
    store.observe('mail.shed', { purpose: 'beta-access', pending: 68 });
    store.observe('auth.rate_limit.network_denied', { scope: 'ipv6_48' });
    store.observe('auth.rate_limit.network_denied', { scope: 'ipv6_48' });
    store.observe('auth.rate_limit.network_denied', { scope: 'ipv4_24' });
    store.observe('auth.rate_limit.network_denied', { scope: 'ipv6_32' });
    assert({
      given:
        '2 denials, 1 limiter outage, mail failures for auth, beta access and an unknown purpose, 2 shed pieces of auth work and 1 of another purpose, and network denials for two known scopes and one unknown',
      should: 'count each independently',
      actual: {
        rateLimitDeniedTotal: store.snapshot().rateLimitDeniedTotal,
        rateLimitUnavailableTotal: store.snapshot().rateLimitUnavailableTotal,
        mailDeliveryFailuresByPurpose:
          store.snapshot().mailDeliveryFailuresByPurpose,
        authMailShedTotal: store.snapshot().authMailShedTotal,
        networkDeniedByScope: store.snapshot().networkDeniedByScope,
      },
      expected: {
        rateLimitDeniedTotal: 2,
        rateLimitUnavailableTotal: 1,
        // An unknown purpose is not a label either.
        mailDeliveryFailuresByPurpose: { auth: 1, 'beta-access': 1 },
        authMailShedTotal: 2,
        // An unknown scope is not a label: cardinality stays bounded.
        networkDeniedByScope: { ipv6_56: 0, ipv6_48: 2, ipv4_24: 1 },
      },
    });
  });

  test('buckets retention sweep failures by their own bounded target name', () => {
    const store = createMetricsStore();
    store.observe('retention.sweep.failed', { operation: 'retention.session' });
    store.observe('retention.sweep.failed', { operation: 'retention.session' });
    store.observe('retention.sweep.failed', {
      operation: 'retention.verification',
    });
    assert({
      given: 'two failures of one target and one of another',
      should: 'tally each target name separately',
      actual: store.snapshot().retentionSweepFailuresByOperation,
      expected: { 'retention.session': 2, 'retention.verification': 1 },
    });
  });

  test('counts failed worker runs by worker, and an unknown name not at all', () => {
    const store = createMetricsStore();
    store.observe('worker.run.failed', { operation: 'privacy_jobs' });
    store.observe('worker.run.failed', { operation: 'privacy_jobs' });
    store.observe('worker.run.failed', { operation: 'not_a_worker' });
    assert({
      given: 'two failures of one worker and one unknown name',
      should: 'tally the worker and keep every label bounded',
      actual: store.snapshot().workerRunFailuresByWorker,
      expected: {
        observation_purges: 0,
        privacy_jobs: 2,
        messaging_file_maintenance: 0,
      },
    });
  });

  test('gives a slow check-in and a slow inbox their own histograms, and an unlisted name none', () => {
    const store = createMetricsStore();
    const completed = (operation: string, durationMs: number) =>
      store.observe('http.request.completed', {
        operation,
        status: 200,
        durationMs,
      });
    completed('attendance.check-in', 2_000);
    completed('messaging.inbox', 40);
    completed('not.a.route', 40);
    assert({
      given: 'two real operations and one no handler can pass',
      should: 'keep one histogram per real operation and mint no other label',
      actual: Object.entries(store.snapshot().latencyMsByOperation).map(
        ([operation, { count, sum }]) => [operation, count, sum],
      ),
      expected: [
        ['attendance.check-in', 1, 2_000],
        ['messaging.inbox', 1, 40],
      ],
    });
  });

  test('ignores unrelated events', () => {
    const store = createMetricsStore();
    store.observe('auth.magic_link.verified', {});
    assert({
      given: 'an event this store does not track',
      should: 'leave every counter and histogram empty',
      actual: store.snapshot(),
      expected: {
        httpRequestsByStatusClass: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 },
        rateLimitDeniedTotal: 0,
        rateLimitUnavailableTotal: 0,
        mailDeliveryFailuresByPurpose: { auth: 0, 'beta-access': 0 },
        authMailShedTotal: 0,
        networkDeniedByScope: { ipv6_56: 0, ipv6_48: 0, ipv4_24: 0 },
        workerRunFailuresByWorker: {
          observation_purges: 0,
          privacy_jobs: 0,
          messaging_file_maintenance: 0,
        },
        retentionSweepFailuresByOperation: {},
        latencyMsByOperation: {},
      },
    });
  });

  test('observes latency into cumulative bounded buckets, by operation', () => {
    const store = createMetricsStore();
    store.observe('http.request.completed', {
      operation: 'auth.request',
      status: 200,
      durationMs: 30,
    });
    store.observe('http.request.failed', {
      operation: 'auth.request',
      status: 503,
      durationMs: 600,
    });
    const histogram = store.snapshot().latencyMsByOperation['auth.request'];
    assert({
      given: 'one 30ms success and one 600ms failure for the same operation',
      should:
        'count the 30ms sample into every bucket >= 50ms and the 600ms sample only into buckets >= 1000ms, with count/sum tracked',
      actual: histogram,
      expected: {
        bucketCounts: LATENCY_BUCKETS_MS.map(
          (boundary) => [30, 600].filter((d) => d <= boundary).length,
        ),
        count: 2,
        sum: 630,
      },
    });
  });

  test('tracks latency for every known operation, not only auth-prefixed ones', () => {
    const store = createMetricsStore();
    store.observe('http.request.completed', {
      operation: 'health.readiness',
      status: 200,
      durationMs: 10,
    });
    assert({
      given: 'a non-auth known operation',
      should: 'still record its own latency histogram',
      actual: store.snapshot().latencyMsByOperation['health.readiness']?.count,
      expected: 1,
    });
  });
});
