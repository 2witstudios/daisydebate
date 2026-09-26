import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { fixedClock } from '@daisy/clock';
import {
  createAlertRecorder,
  withAlertRecording,
  type AlertRecorderRedis,
} from './alert-recorder';

setupRitewayBun();

type Call = { readonly op: string; readonly args: readonly unknown[] };

function fakeAlertRedis() {
  const calls: Call[] = [];
  const redis: AlertRecorderRedis = {
    setIfAbsent: async (key, value, ttl) => {
      calls.push({ op: 'setIfAbsent', args: [key, value, ttl] });
      return value;
    },
    incrementWithExpiry: async (key, ttl) => {
      calls.push({ op: 'incrementWithExpiry', args: [key, ttl] });
      return 1;
    },
    delete: async (key) => {
      calls.push({ op: 'delete', args: [key] });
    },
    setEphemeral: async (key, value, ttl) => {
      calls.push({ op: 'setEphemeral', args: [key, value, ttl] });
    },
  };
  return { redis, calls };
}

const NOW = '2026-09-25T12:00:00.000Z';

describe('createAlertRecorder (AUTH-7.7)', () => {
  test('marks storage unavailable on auth.session.unavailable', () => {
    const { redis, calls } = fakeAlertRedis();
    const recorder = createAlertRecorder({ redis, clock: fixedClock(NOW) });
    recorder.observe('auth.session.unavailable', { operation: 'x' });
    assert({
      given: 'a session storage unavailability event',
      should:
        'set the storage marker if absent, with the 3-minute bridging TTL',
      actual: calls,
      expected: [
        { op: 'setIfAbsent', args: ['alert-unavailable-storage', NOW, 180] },
      ],
    });
  });

  test('marks the limiter unavailable on auth.rate_limit.unavailable', () => {
    const { redis, calls } = fakeAlertRedis();
    const recorder = createAlertRecorder({ redis, clock: fixedClock(NOW) });
    recorder.observe('auth.rate_limit.unavailable', {});
    assert({
      given: 'a rate-limiter unavailability event',
      should: 'set the limiter marker if absent',
      actual: calls,
      expected: [
        { op: 'setIfAbsent', args: ['alert-unavailable-limiter', NOW, 180] },
      ],
    });
  });

  test('increments consecutive mail failures on auth.mail.failed, resets on auth.mail.sent', () => {
    const { redis, calls } = fakeAlertRedis();
    const recorder = createAlertRecorder({ redis, clock: fixedClock(NOW) });
    recorder.observe('auth.mail.failed', {});
    recorder.observe('auth.mail.sent', {});
    assert({
      given: 'a delivery failure followed by a successful send',
      should: 'increment the bounded counter then delete it',
      actual: calls,
      expected: [
        {
          op: 'incrementWithExpiry',
          args: ['alert-mail-consecutive-failures', 3600],
        },
        { op: 'delete', args: ['alert-mail-consecutive-failures'] },
      ],
    });
  });

  test('records the last successful sweep on retention.sweep.completed', () => {
    const { redis, calls } = fakeAlertRedis();
    const recorder = createAlertRecorder({ redis, clock: fixedClock(NOW) });
    recorder.observe('retention.sweep.completed', {
      operation: 'retention.session',
    });
    assert({
      given: 'a completed retention sweep',
      should: 'record the durable last-success marker',
      actual: calls,
      expected: [
        {
          op: 'setEphemeral',
          args: ['alert-retention-last-success', NOW, 2_592_000],
        },
      ],
    });
  });

  test('never records anything for retention.sweep.failed (lets it go stale)', () => {
    const { redis, calls } = fakeAlertRedis();
    const recorder = createAlertRecorder({ redis, clock: fixedClock(NOW) });
    recorder.observe('retention.sweep.failed', {
      operation: 'retention.session',
    });
    assert({
      given: 'a failed retention sweep',
      should: 'touch nothing, so cleanup_missed can fire once stale enough',
      actual: calls,
      expected: [],
    });
  });

  test('counts auth-operation http completions into the current minute bucket, 5xx separately', () => {
    const { redis, calls } = fakeAlertRedis();
    const recorder = createAlertRecorder({ redis, clock: fixedClock(NOW) });
    const bucket = Math.floor(Date.parse(NOW) / 60_000);
    recorder.observe('http.request.completed', {
      operation: 'auth.request',
      status: 200,
    });
    recorder.observe('http.request.failed', {
      operation: 'auth.request',
      status: 503,
    });
    assert({
      given: 'a successful and a failed auth-operation request',
      should:
        'increment the total bucket for both and the 5xx bucket only for the failure',
      actual: calls,
      expected: [
        {
          op: 'incrementWithExpiry',
          args: [`alert-http-total-${bucket}`, 660],
        },
        {
          op: 'incrementWithExpiry',
          args: [`alert-http-total-${bucket}`, 660],
        },
        { op: 'incrementWithExpiry', args: [`alert-http-5xx-${bucket}`, 660] },
      ],
    });
  });

  test('ignores non-auth operations and completions without a numeric status', () => {
    const { redis, calls } = fakeAlertRedis();
    const recorder = createAlertRecorder({ redis, clock: fixedClock(NOW) });
    recorder.observe('http.request.completed', {
      operation: 'health.readiness',
      status: 200,
    });
    recorder.observe('http.request.completed', { operation: 'auth.request' });
    assert({
      given: 'a non-auth operation and an auth operation with no status field',
      should:
        'record nothing for either (bounded cardinality: only auth.* counted)',
      actual: calls,
      expected: [],
    });
  });

  test('ignores events outside the observed set', () => {
    const { redis, calls } = fakeAlertRedis();
    const recorder = createAlertRecorder({ redis, clock: fixedClock(NOW) });
    recorder.observe('auth.magic_link.verified', { operation: 'auth.request' });
    assert({
      given: 'an event this recorder does not track',
      should: 'touch Redis for nothing',
      actual: calls,
      expected: [],
    });
  });

  test('a Redis failure is swallowed, never thrown back at the caller', () => {
    const redis: AlertRecorderRedis = {
      setIfAbsent: async () => {
        throw new Error('redis down');
      },
      incrementWithExpiry: async () => {
        throw new Error('redis down');
      },
      delete: async () => {
        throw new Error('redis down');
      },
      setEphemeral: async () => {
        throw new Error('redis down');
      },
    };
    const recorder = createAlertRecorder({ redis, clock: fixedClock(NOW) });
    let threw = false;
    try {
      recorder.observe('auth.session.unavailable', {});
    } catch {
      threw = true;
    }
    assert({
      given: 'a Redis command that rejects',
      should: 'never throw synchronously back at the logger call site',
      actual: threw,
      expected: false,
    });
  });
});

describe('withAlertRecording (AUTH-7.7)', () => {
  test('feeds every logged event, including from children, to the recorder', () => {
    const observed: Array<{ event: string; fields: Record<string, unknown> }> =
      [];
    const logged: Array<{ event: string; fields: Record<string, unknown> }> =
      [];
    const baseLogger = {
      log: (event: string, fields: Record<string, unknown>) =>
        void logged.push({ event, fields }),
      child(fields: Record<string, unknown>) {
        return {
          log: (event: string, childFields: Record<string, unknown>) =>
            void logged.push({ event, fields: { ...fields, ...childFields } }),
          child: () => this,
        };
      },
    };
    const wrapped = withAlertRecording(baseLogger, {
      observe: (event, fields) => observed.push({ event, fields }),
    });
    wrapped.log('auth.mail.failed', {}, 'msg');
    const child = wrapped.child({ requestId: 'r1' });
    child.log(
      'retention.sweep.completed',
      { operation: 'retention.session' },
      'msg',
    );
    assert({
      given: 'a top-level log and a child log',
      should: 'observe both and still forward both to the wrapped logger',
      actual: {
        observedEvents: observed.map((entry) => entry.event),
        loggedEvents: logged.map((entry) => entry.event),
      },
      expected: {
        observedEvents: ['auth.mail.failed', 'retention.sweep.completed'],
        loggedEvents: ['auth.mail.failed', 'retention.sweep.completed'],
      },
    });
  });
});
