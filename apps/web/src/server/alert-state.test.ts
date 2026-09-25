import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  ALERT_THRESHOLDS,
  evaluateAlerts,
  readAlertSnapshot,
  type AlertSnapshot,
} from './alert-state';

setupRitewayBun();

const NOW = '2026-09-25T12:00:00.000Z';

const baseSnapshot: AlertSnapshot = {
  nowIso: NOW,
  storageUnavailableSinceIso: null,
  limiterUnavailableSinceIso: null,
  deliveryConsecutiveFailures: 0,
  authRequests: { total: 0, serverErrors: 0, windowMinutes: 10 },
  retentionLastSuccessIso: null,
};

describe('evaluateAlerts (AUTH-7.7)', () => {
  test('a healthy snapshot with a recent sweep fires no conditions', () => {
    assert({
      given: 'no unavailability, no failures, a recent successful sweep',
      should: 'fire nothing',
      actual: evaluateAlerts({
        ...baseSnapshot,
        retentionLastSuccessIso: '2026-09-25T11:30:00.000Z',
      }),
      expected: [],
    });
  });

  test('storage unavailable for exactly the threshold fires; just under it does not', () => {
    const justUnder = new Date(
      Date.parse(NOW) - ALERT_THRESHOLDS.unavailableMs + 1,
    ).toISOString();
    const atThreshold = new Date(
      Date.parse(NOW) - ALERT_THRESHOLDS.unavailableMs,
    ).toISOString();
    assert({
      given: 'storage unavailable for one millisecond under 2 minutes',
      should: 'not fire (negative control)',
      actual: evaluateAlerts({
        ...baseSnapshot,
        storageUnavailableSinceIso: justUnder,
        retentionLastSuccessIso: NOW,
      }).map((c) => c.id),
      expected: [],
    });
    assert({
      given: 'storage unavailable for exactly 2 minutes',
      should: 'fire storage_unavailable',
      actual: evaluateAlerts({
        ...baseSnapshot,
        storageUnavailableSinceIso: atThreshold,
        retentionLastSuccessIso: NOW,
      }).map((c) => c.id),
      expected: ['storage_unavailable'],
    });
  });

  test('limiter unavailable for 2+ minutes fires limiter_unavailable', () => {
    const since = new Date(
      Date.parse(NOW) - ALERT_THRESHOLDS.unavailableMs - 1000,
    ).toISOString();
    assert({
      given: 'the rate limiter unavailable for over 2 minutes',
      should: 'fire limiter_unavailable',
      actual: evaluateAlerts({
        ...baseSnapshot,
        limiterUnavailableSinceIso: since,
        retentionLastSuccessIso: NOW,
      }).map((c) => c.id),
      expected: ['limiter_unavailable'],
    });
  });

  test('3 consecutive delivery failures fire; 2 does not', () => {
    assert({
      given: '2 consecutive delivery failures',
      should: 'not fire (negative control)',
      actual: evaluateAlerts({
        ...baseSnapshot,
        deliveryConsecutiveFailures: 2,
        retentionLastSuccessIso: NOW,
      }).map((c) => c.id),
      expected: [],
    });
    assert({
      given: '3 consecutive delivery failures',
      should: 'fire delivery_failures',
      actual: evaluateAlerts({
        ...baseSnapshot,
        deliveryConsecutiveFailures: 3,
        retentionLastSuccessIso: NOW,
      }).map((c) => c.id),
      expected: ['delivery_failures'],
    });
  });

  test('auth 5xx above 1% with at least 100 requests fires; below either threshold does not', () => {
    assert({
      given: '2% 5xx rate but only 50 requests (below the 100-request floor)',
      should: 'not fire (negative control)',
      actual: evaluateAlerts({
        ...baseSnapshot,
        authRequests: { total: 50, serverErrors: 1, windowMinutes: 10 },
        retentionLastSuccessIso: NOW,
      }).map((c) => c.id),
      expected: [],
    });
    assert({
      given: 'exactly 1% 5xx (at, not above, the threshold) over 100 requests',
      should: 'not fire (negative control)',
      actual: evaluateAlerts({
        ...baseSnapshot,
        authRequests: { total: 100, serverErrors: 1, windowMinutes: 10 },
        retentionLastSuccessIso: NOW,
      }).map((c) => c.id),
      expected: [],
    });
    assert({
      given: 'a 2% 5xx rate over 100 requests',
      should: 'fire auth_5xx_rate',
      actual: evaluateAlerts({
        ...baseSnapshot,
        authRequests: { total: 100, serverErrors: 2, windowMinutes: 10 },
        retentionLastSuccessIso: NOW,
      }).map((c) => c.id),
      expected: ['auth_5xx_rate'],
    });
  });

  test('a retention sweep silent for 2+ hours, or never successful, fires cleanup_missed', () => {
    const justUnder = new Date(
      Date.parse(NOW) - ALERT_THRESHOLDS.retentionMissedMs + 1,
    ).toISOString();
    const atThreshold = new Date(
      Date.parse(NOW) - ALERT_THRESHOLDS.retentionMissedMs,
    ).toISOString();
    assert({
      given: 'a sweep that succeeded just under 2 hours ago',
      should: 'not fire (negative control)',
      actual: evaluateAlerts({ ...baseSnapshot, retentionLastSuccessIso: justUnder })
        .map((c) => c.id),
      expected: [],
    });
    assert({
      given: 'a sweep that last succeeded exactly 2 hours ago',
      should: 'fire cleanup_missed',
      actual: evaluateAlerts({ ...baseSnapshot, retentionLastSuccessIso: atThreshold })
        .map((c) => c.id),
      expected: ['cleanup_missed'],
    });
    assert({
      given: 'a sweep that has never once succeeded (fresh/never-recorded state)',
      should: 'fire cleanup_missed',
      actual: evaluateAlerts(baseSnapshot).map((c) => c.id),
      expected: ['cleanup_missed'],
    });
  });

  test('every condition names its own runbook anchor', () => {
    const since = new Date(
      Date.parse(NOW) - ALERT_THRESHOLDS.unavailableMs - 1,
    ).toISOString();
    const conditions = evaluateAlerts({
      nowIso: NOW,
      storageUnavailableSinceIso: since,
      limiterUnavailableSinceIso: since,
      deliveryConsecutiveFailures: 3,
      authRequests: { total: 100, serverErrors: 5, windowMinutes: 10 },
      retentionLastSuccessIso: null,
    });
    assert({
      given: 'every alert condition firing at once',
      should: 'each name a runbook path into auth-delivery.md',
      actual: conditions.every((c) => c.runbook.startsWith('docs/operations/auth-delivery.md#')),
      expected: true,
    });
  });
});

describe('readAlertSnapshot (AUTH-7.7)', () => {
  const clock = { now: () => NOW };

  test('reads each durable marker and sums the request window', async () => {
    const currentBucket = Math.floor(Date.parse(NOW) / 60_000);
    const values = new Map<string, string>([
      ['alert-unavailable-storage', '2026-09-25T11:58:00.000Z'],
      ['alert-mail-consecutive-failures', '2'],
      ['alert-retention-last-success', '2026-09-25T11:00:00.000Z'],
      [`alert-http-total-${currentBucket}`, '40'],
      [`alert-http-5xx-${currentBucket}`, '1'],
      [`alert-http-total-${currentBucket - 5}`, '60'],
      [`alert-http-5xx-${currentBucket - 5}`, '2'],
    ]);
    const redis = { get: async (key: string) => values.get(key) ?? null };
    assert({
      given: 'markers spread across the 10-minute request window',
      should: 'assemble one snapshot summing every bucket in range',
      actual: await readAlertSnapshot({ redis, clock }),
      expected: {
        nowIso: NOW,
        storageUnavailableSinceIso: '2026-09-25T11:58:00.000Z',
        limiterUnavailableSinceIso: null,
        deliveryConsecutiveFailures: 2,
        authRequests: { total: 100, serverErrors: 3, windowMinutes: 10 },
        retentionLastSuccessIso: '2026-09-25T11:00:00.000Z',
      },
    });
  });

  test('an all-absent Redis state reads as a clean, never-alerted snapshot', async () => {
    const redis = { get: async () => null };
    assert({
      given: 'no markers set at all',
      should: 'default counts to zero and timestamps to null',
      actual: await readAlertSnapshot({ redis, clock }),
      expected: {
        nowIso: NOW,
        storageUnavailableSinceIso: null,
        limiterUnavailableSinceIso: null,
        deliveryConsecutiveFailures: 0,
        authRequests: { total: 0, serverErrors: 0, windowMinutes: 10 },
        retentionLastSuccessIso: null,
      },
    });
  });
});
