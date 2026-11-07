import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  ALERT_THRESHOLDS,
  evaluateAlerts,
  readAlertSnapshot,
  runningWorkers,
  workerSuccessKey,
} from './alert-state';
import { emptySnapshot } from './alert-state.test-support';

import { OBSERVATION_PURGE_BACKOFF_CEILING_MS } from '@daisy/db/privacy';
import { PRIVACY_JOBS_RETRY_MAX_MS } from '../../server/privacy-jobs';

setupRitewayBun();

const NOW = '2026-09-25T12:00:00.000Z';

const baseSnapshot = emptySnapshot(NOW);

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

  test('no complete retention run for 3+ hours, or ever, fires cleanup_missed', () => {
    const justUnder = new Date(
      Date.parse(NOW) - ALERT_THRESHOLDS.retentionMissedMs + 1,
    ).toISOString();
    const atThreshold = new Date(
      Date.parse(NOW) - ALERT_THRESHOLDS.retentionMissedMs,
    ).toISOString();
    assert({
      given: 'a run that completed just under 3 hours ago',
      should: 'not fire (negative control)',
      actual: evaluateAlerts({
        ...baseSnapshot,
        retentionLastSuccessIso: justUnder,
      }).map((c) => c.id),
      expected: [],
    });
    assert({
      given: 'a run that last completed exactly 3 hours ago',
      should: 'fire cleanup_missed',
      actual: evaluateAlerts({
        ...baseSnapshot,
        retentionLastSuccessIso: atThreshold,
      }).map((c) => c.id),
      expected: ['cleanup_missed'],
    });
    assert({
      given:
        'a sweep that has never once succeeded (fresh/never-recorded state)',
      should: 'fire cleanup_missed',
      actual: evaluateAlerts(baseSnapshot).map((c) => c.id),
      expected: ['cleanup_missed'],
    });
  });

  test('a running worker past its threshold, or never healthy, fires its own alert (ISSUE-1007)', () => {
    const ago = (ms: number) => new Date(Date.parse(NOW) - ms).toISOString();
    const fresh = {
      ...baseSnapshot,
      retentionLastSuccessIso: NOW,
    };
    const worker = (lastSuccessIso: string | null) => ({
      name: 'privacy_jobs' as const,
      missedAfterMs: 1_000,
      lastSuccessIso,
    });
    assert({
      given: 'a worker healthy just under its threshold',
      should: 'not fire (negative control)',
      actual: evaluateAlerts({ ...fresh, workers: [worker(ago(999))] }).map(
        (c) => c.id,
      ),
      expected: [],
    });
    assert({
      given: 'a worker last healthy exactly at its threshold',
      should: 'fire its own alert, not cleanup_missed',
      actual: evaluateAlerts({ ...fresh, workers: [worker(ago(1_000))] }).map(
        (c) => c.id,
      ),
      expected: ['privacy_jobs_missed'],
    });
    assert({
      given: 'a running worker with no healthy run on record',
      should: 'fire its own alert',
      actual: evaluateAlerts({ ...fresh, workers: [worker(null)] }).map(
        (c) => c.id,
      ),
      expected: ['privacy_jobs_missed'],
    });
    assert({
      given: 'a worker this process does not run',
      should: 'raise nothing',
      actual: evaluateAlerts(fresh).map((c) => c.id),
      expected: [],
    });
  });

  test('Billing cleanup retains its own missed alert while generic privacy is healthy', () => {
    const threshold = ALERT_THRESHOLDS.workerMissedMs.billing_cleanup;
    const snapshot = (elapsed: number) => ({
      ...baseSnapshot,
      retentionLastSuccessIso: NOW,
      workers: [
        {
          name: 'privacy_jobs' as const,
          missedAfterMs: threshold,
          lastSuccessIso: NOW,
        },
        {
          name: 'billing_cleanup' as const,
          missedAfterMs: threshold,
          lastSuccessIso: new Date(Date.parse(NOW) - elapsed).toISOString(),
        },
      ],
    });
    assert({
      given:
        'generic privacy is healthy and Billing has not passed its own threshold',
      should: 'keep the Billing alert quiet until the exact boundary',
      actual: evaluateAlerts(snapshot(threshold - 1)),
      expected: [],
    });
    assert({
      given:
        'Billing last healthy exactly two hours ago despite healthy generic privacy',
      should: 'emit the named Billing alert and its operator runbook',
      actual: evaluateAlerts(snapshot(threshold)).map(({ id, runbook }) => ({
        id,
        runbook,
      })),
      expected: [
        {
          id: 'billing_cleanup_missed',
          runbook: 'docs/operations/auth-delivery.md#scheduled-worker-missed',
        },
      ],
    });
  });

  test('each worker threshold outlasts its backoff ceiling, so one retry never pages', () => {
    assert({
      given: 'the thresholds and the backoff ceilings their workers use',
      should: 'leave room for a retry at the longest wait',
      actual: {
        observation:
          ALERT_THRESHOLDS.workerMissedMs.observation_purges >
          OBSERVATION_PURGE_BACKOFF_CEILING_MS,
        privacy:
          ALERT_THRESHOLDS.workerMissedMs.privacy_jobs >
          PRIVACY_JOBS_RETRY_MAX_MS,
        billing:
          ALERT_THRESHOLDS.workerMissedMs.billing_cleanup >
          PRIVACY_JOBS_RETRY_MAX_MS,
      },
      expected: { observation: true, privacy: true, billing: true },
    });
  });

  test('file maintenance is expected only when configured, and never faster than its own interval', () => {
    const names = (fileMaintenanceIntervalMs: number | null) =>
      runningWorkers({ fileMaintenanceIntervalMs }).map(({ name }) => name);
    assert({
      given: 'no configured file maintenance',
      should: 'expect the three always-on workers',
      actual: names(null),
      expected: ['observation_purges', 'privacy_jobs', 'billing_cleanup'],
    });
    assert({
      given: 'configured file maintenance',
      should: 'expect it too',
      actual: names(60_000),
      expected: [
        'observation_purges',
        'privacy_jobs',
        'billing_cleanup',
        'messaging_file_maintenance',
      ],
    });
    const DAY_MS = 86_400_000;
    assert({
      given: 'a daily maintenance interval',
      should: 'allow three intervals before it counts as missed',
      actual: runningWorkers({ fileMaintenanceIntervalMs: DAY_MS }).at(-1)
        ?.missedAfterMs,
      expected: 3 * DAY_MS,
    });
  });

  test('handed-off mail shed at the threshold over its window fires mail_shed; one under does not (ISSUE-220)', () => {
    const shed = (count: number) =>
      evaluateAlerts({
        ...baseSnapshot,
        retentionLastSuccessIso: NOW,
        mailShed: { count, windowMinutes: 10 },
      });
    const [fired] = shed(ALERT_THRESHOLDS.mailShedCount);
    assert({
      given: `${ALERT_THRESHOLDS.mailShedCount - 1}, then ${ALERT_THRESHOLDS.mailShedCount}, shed tasks in the window`,
      should:
        'fire nothing, then mail_shed with the count and window only, pointing at its runbook section',
      actual: [shed(ALERT_THRESHOLDS.mailShedCount - 1), fired],
      expected: [
        [],
        {
          id: 'mail_shed',
          summary: `${ALERT_THRESHOLDS.mailShedCount} handed-off auth mail tasks shed in 10m: sign-in and sign-up mail is being dropped`,
          runbook:
            'docs/operations/auth-delivery.md#auth-mail-shed-past-the-bound',
        },
      ],
    });
  });

  test('network denials at the threshold over their window fire network_limited; one under does not (AUTH-3.10)', () => {
    const denied = (count: number) =>
      evaluateAlerts({
        ...baseSnapshot,
        retentionLastSuccessIso: NOW,
        networkDenied: { count, windowMinutes: 10 },
      });
    const [fired] = denied(ALERT_THRESHOLDS.networkDeniedCount);
    assert({
      given: `${ALERT_THRESHOLDS.networkDeniedCount - 1}, then ${ALERT_THRESHOLDS.networkDeniedCount}, magic-link requests denied for their network in the window`,
      should:
        'fire nothing, then network_limited with the count and window only, pointing at its runbook section',
      actual: [denied(ALERT_THRESHOLDS.networkDeniedCount - 1), fired],
      expected: [
        [],
        {
          id: 'network_limited',
          summary: `${ALERT_THRESHOLDS.networkDeniedCount} magic-link requests denied for their network in 10m: one network is flooding sign-in`,
          runbook:
            'docs/operations/auth-delivery.md#magic-link-requests-limited-per-network',
        },
      ],
    });
  });

  test('every condition names its own runbook anchor', () => {
    const since = new Date(
      Date.parse(NOW) - ALERT_THRESHOLDS.unavailableMs - 1,
    ).toISOString();
    const conditions = evaluateAlerts({
      ...baseSnapshot,
      storageUnavailableSinceIso: since,
      limiterUnavailableSinceIso: since,
      deliveryConsecutiveFailures: 3,
      authRequests: { total: 100, serverErrors: 5, windowMinutes: 10 },
      mailShed: { count: ALERT_THRESHOLDS.mailShedCount, windowMinutes: 10 },
      networkDenied: {
        count: ALERT_THRESHOLDS.networkDeniedCount,
        windowMinutes: 10,
      },
    });
    assert({
      given: 'every alert condition firing at once, mail_shed included',
      should: 'each name a runbook path into auth-delivery.md',
      actual: conditions.every((c) =>
        c.runbook.startsWith('docs/operations/auth-delivery.md#'),
      ),
      expected: true,
    });
  });
});

describe('readAlertSnapshot (AUTH-7.7)', () => {
  const clock = { now: () => NOW };
  const noLocalOutage = { limiterUnavailableSince: () => null };

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
      [`alert-mail-shed-${currentBucket}`, '15'],
      [`alert-mail-shed-${currentBucket - 9}`, '7'],
      [`alert-mail-shed-${currentBucket - 10}`, '100'],
      [`alert-network-denied-${currentBucket - 1}`, '400'],
      [`alert-network-denied-${currentBucket - 10}`, '9000'],
    ]);
    const redis = { get: async (key: string) => values.get(key) ?? null };
    assert({
      given:
        'markers spread across the 10-minute request and shed windows, and a shed bucket just outside',
      should: 'assemble one snapshot summing every bucket in range only',
      actual: await readAlertSnapshot({
        redis,
        clock,
        local: noLocalOutage,
        workers: [],
      }),
      expected: {
        nowIso: NOW,
        redisState: 'read',
        storageUnavailableSinceIso: '2026-09-25T11:58:00.000Z',
        limiterUnavailableSinceIso: null,
        deliveryConsecutiveFailures: 2,
        authRequests: { total: 100, serverErrors: 3, windowMinutes: 10 },
        retentionLastSuccessIso: '2026-09-25T11:00:00.000Z',
        workers: [],
        mailShed: { count: 22, windowMinutes: 10 },
        networkDenied: { count: 400, windowMinutes: 10 },
      },
    });
  });

  test('reads only the running workers, each from its own marker (ISSUE-1007)', async () => {
    const values = new Map([
      [workerSuccessKey('privacy_jobs'), NOW],
      [workerSuccessKey('messaging_file_maintenance'), NOW],
    ]);
    const snapshot = await readAlertSnapshot({
      redis: { get: async (key) => values.get(key) ?? null },
      clock,
      local: noLocalOutage,
      workers: [
        { name: 'privacy_jobs', missedAfterMs: 1 },
        { name: 'observation_purges', missedAfterMs: 2 },
      ],
    });
    assert({
      given:
        'two running workers, one with a marker, and a marker for one not running',
      should: 'report the two running workers only',
      actual: snapshot.redisState === 'read' ? snapshot.workers : [],
      expected: [
        { name: 'privacy_jobs', missedAfterMs: 1, lastSuccessIso: NOW },
        { name: 'observation_purges', missedAfterMs: 2, lastSuccessIso: null },
      ],
    });
  });

  test('an all-absent Redis state reads as a clean, never-alerted snapshot', async () => {
    const redis = { get: async () => null };
    assert({
      given: 'no markers set at all',
      should: 'default counts to zero and timestamps to null',
      actual: await readAlertSnapshot({
        redis,
        clock,
        local: noLocalOutage,
        workers: [],
      }),
      expected: baseSnapshot,
    });
  });
});
