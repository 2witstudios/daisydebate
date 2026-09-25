import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createMetricsStore, formatPrometheusMetrics } from './metrics-store';

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
    store.observe('auth.mail.failed', {});
    assert({
      given: '2 denials, 1 limiter outage, 1 mail failure',
      should: 'count each independently',
      actual: {
        rateLimitDeniedTotal: store.snapshot().rateLimitDeniedTotal,
        rateLimitUnavailableTotal: store.snapshot().rateLimitUnavailableTotal,
        mailDeliveryFailuresTotal: store.snapshot().mailDeliveryFailuresTotal,
      },
      expected: {
        rateLimitDeniedTotal: 2,
        rateLimitUnavailableTotal: 1,
        mailDeliveryFailuresTotal: 1,
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

  test('ignores unrelated events', () => {
    const store = createMetricsStore();
    store.observe('auth.magic_link.verified', {});
    assert({
      given: 'an event this store does not track',
      should: 'leave every counter at zero',
      actual: store.snapshot(),
      expected: {
        httpRequestsByStatusClass: { '2xx': 0, '3xx': 0, '4xx': 0, '5xx': 0 },
        rateLimitDeniedTotal: 0,
        rateLimitUnavailableTotal: 0,
        mailDeliveryFailuresTotal: 0,
        retentionSweepFailuresByOperation: {},
      },
    });
  });
});

describe('formatPrometheusMetrics (AUTH-7.7)', () => {
  test('renders one HELP/TYPE/sample line group per metric, with bounded labels', () => {
    const store = createMetricsStore();
    store.observe('http.request.completed', {
      operation: 'auth.request',
      status: 200,
    });
    store.observe('retention.sweep.failed', { operation: 'retention.session' });
    const text = formatPrometheusMetrics(store.snapshot());
    assert({
      given: 'a snapshot with one 2xx auth request and one retention failure',
      should:
        'expose Prometheus text exposition with the sample values present',
      actual: {
        hasHelp: text.includes('# HELP auth_http_requests_total'),
        hasType: text.includes('# TYPE auth_http_requests_total counter'),
        has2xxSample: text.includes(
          'auth_http_requests_total{status_class="2xx"} 1',
        ),
        hasRetentionSample: text.includes(
          'retention_sweep_failures_total{operation="retention.session"} 1',
        ),
        endsWithNewline: text.endsWith('\n'),
      },
      expected: {
        hasHelp: true,
        hasType: true,
        has2xxSample: true,
        hasRetentionSample: true,
        endsWithNewline: true,
      },
    });
  });
});
