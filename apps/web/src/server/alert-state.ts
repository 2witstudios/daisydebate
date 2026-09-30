import { withTimeout } from '@daisy/observability';

const MINUTE_MS = 60_000;

/**
 * Each Redis read behind `/api/ops/alerts` is abandoned after this long,
 * the same budget readiness gives its PING, so a Redis that stops
 * answering yields a `redisState: 'unreachable'` snapshot instead of a
 * request that never ends (ISSUE-208). Bounded per command, not by the
 * client's own defaults, which leave a stalled connection pending.
 */
export const ALERT_STATE_READ_TIMEOUT_MS = 2_000;

/**
 * The AUTH-7.7 alert thresholds, named once so `evaluateAlerts` and its
 * tests read the same numbers the runbook documents
 * (`docs/operations/auth-delivery.md`).
 */
export const ALERT_THRESHOLDS = {
  unavailableMs: 2 * MINUTE_MS,
  consecutiveDeliveryFailures: 3,
  auth5xxWindowMinutes: 10,
  auth5xxMinRequests: 100,
  auth5xxRate: 0.01,
  retentionMissedMs: 2 * 60 * MINUTE_MS,
  /**
   * ISSUE-220: handed-off auth mail work shed past its bound (512 holding
   * a slot, 64 waiting; DEC-73, DEC-76) over the trailing window. A
   * saturated minute with some real sign-in traffic can shed a stray task,
   * so it fires on a sustained count, 20 in 10 minutes, well below what any
   * flood that fills the bound sheds (every request past the 576 held or
   * waiting).
   */
  mailShedWindowMinutes: 10,
  mailShedCount: 20,
} as const;

export type AlertSnapshot = {
  readonly nowIso: string;
  /**
   * Whether the Redis-backed markers below were read. `unreachable` leaves
   * them at their empty values, which `evaluateAlerts` then ignores
   * (ISSUE-191).
   */
  readonly redisState: 'read' | 'unreachable';
  readonly storageUnavailableSinceIso: string | null;
  readonly limiterUnavailableSinceIso: string | null;
  readonly deliveryConsecutiveFailures: number;
  readonly authRequests: {
    readonly total: number;
    readonly serverErrors: number;
    readonly windowMinutes: number;
  };
  readonly retentionLastSuccessIso: string | null;
  /** `auth.mail.shed` events over the trailing window (ISSUE-220). */
  readonly mailShed: {
    readonly count: number;
    readonly windowMinutes: number;
  };
};

type AlertConditionId =
  | 'storage_unavailable'
  | 'limiter_unavailable'
  | 'delivery_failures'
  | 'auth_5xx_rate'
  | 'cleanup_missed'
  | 'mail_shed';

export type AlertCondition = {
  readonly id: AlertConditionId;
  readonly summary: string;
  readonly runbook: string;
};

const RUNBOOK_ANCHOR = {
  storage_unavailable: '#storage-or-rate-limiter-unavailable',
  limiter_unavailable: '#storage-or-rate-limiter-unavailable',
  delivery_failures: '#delivery-provider-failing-repeatedly',
  auth_5xx_rate: '#auth-5xx-error-rate-elevated',
  cleanup_missed: '#retention-cleanup-missed',
  mail_shed: '#auth-mail-shed-past-the-bound',
} as const satisfies Record<AlertConditionId, string>;

const runbook = (id: AlertConditionId) =>
  `docs/operations/auth-delivery.md${RUNBOOK_ANCHOR[id]}`;

const elapsedMs = (sinceIso: string, nowIso: string): number =>
  Date.parse(nowIso) - Date.parse(sinceIso);

const checkStorageUnavailable = (
  snapshot: AlertSnapshot,
): AlertCondition | undefined =>
  snapshot.storageUnavailableSinceIso !== null &&
  elapsedMs(snapshot.storageUnavailableSinceIso, snapshot.nowIso) >=
    ALERT_THRESHOLDS.unavailableMs
    ? {
        id: 'storage_unavailable',
        summary: `Session/database storage unavailable since ${snapshot.storageUnavailableSinceIso}`,
        runbook: runbook('storage_unavailable'),
      }
    : undefined;

const checkLimiterUnavailable = (
  snapshot: AlertSnapshot,
): AlertCondition | undefined =>
  snapshot.limiterUnavailableSinceIso !== null &&
  elapsedMs(snapshot.limiterUnavailableSinceIso, snapshot.nowIso) >=
    ALERT_THRESHOLDS.unavailableMs
    ? {
        id: 'limiter_unavailable',
        summary: `Auth rate limiter unavailable since ${snapshot.limiterUnavailableSinceIso}`,
        runbook: runbook('limiter_unavailable'),
      }
    : undefined;

const checkDeliveryFailures = (
  snapshot: AlertSnapshot,
): AlertCondition | undefined =>
  snapshot.deliveryConsecutiveFailures >=
  ALERT_THRESHOLDS.consecutiveDeliveryFailures
    ? {
        id: 'delivery_failures',
        summary: `${snapshot.deliveryConsecutiveFailures} consecutive mail delivery failures`,
        runbook: runbook('delivery_failures'),
      }
    : undefined;

const checkAuth5xxRate = (
  snapshot: AlertSnapshot,
): AlertCondition | undefined => {
  const { total, serverErrors, windowMinutes } = snapshot.authRequests;
  if (
    total < ALERT_THRESHOLDS.auth5xxMinRequests ||
    serverErrors / total <= ALERT_THRESHOLDS.auth5xxRate
  )
    return undefined;
  return {
    id: 'auth_5xx_rate',
    summary: `Auth 5xx rate ${((serverErrors / total) * 100).toFixed(2)}% over ${windowMinutes}m (${serverErrors}/${total} requests)`,
    runbook: runbook('auth_5xx_rate'),
  };
};

const checkCleanupMissed = (
  snapshot: AlertSnapshot,
): AlertCondition | undefined =>
  snapshot.retentionLastSuccessIso === null ||
  elapsedMs(snapshot.retentionLastSuccessIso, snapshot.nowIso) >=
    ALERT_THRESHOLDS.retentionMissedMs
    ? {
        id: 'cleanup_missed',
        summary:
          snapshot.retentionLastSuccessIso === null
            ? 'Retention sweep has not completed successfully since boot'
            : `Retention sweep last succeeded ${snapshot.retentionLastSuccessIso}`,
        runbook: runbook('cleanup_missed'),
      }
    : undefined;

const checkMailShed = (snapshot: AlertSnapshot): AlertCondition | undefined =>
  snapshot.mailShed.count >= ALERT_THRESHOLDS.mailShedCount
    ? {
        id: 'mail_shed',
        summary: `${snapshot.mailShed.count} handed-off auth mail tasks shed in ${snapshot.mailShed.windowMinutes}m: sign-in and sign-up mail is being dropped`,
        runbook: runbook('mail_shed'),
      }
    : undefined;

type AlertCheck = (snapshot: AlertSnapshot) => AlertCondition | undefined;

const ALERT_CHECKS: readonly AlertCheck[] = [
  checkStorageUnavailable,
  checkLimiterUnavailable,
  checkDeliveryFailures,
  checkAuth5xxRate,
  checkCleanupMissed,
  checkMailShed,
];

/** The one check whose state this process keeps without Redis (ISSUE-191). */
const IN_PROCESS_CHECKS: readonly AlertCheck[] = [checkLimiterUnavailable];

/**
 * AUTH-7.7's four alert conditions, evaluated from a snapshot the caller
 * already read (`readAlertSnapshot`). Pure: every threshold and duration
 * decision is a function of the inputs, so this is fully testable without
 * Redis, a clock, or the network.
 */
export function evaluateAlerts(
  snapshot: AlertSnapshot,
): readonly AlertCondition[] {
  const checks =
    snapshot.redisState === 'read' ? ALERT_CHECKS : IN_PROCESS_CHECKS;
  return checks
    .map((check) => check(snapshot))
    .filter(
      (condition): condition is AlertCondition => condition !== undefined,
    );
}

export type AlertStateRedis = {
  readonly get: (key: string) => Promise<string | null>;
};

export type AlertClock = { readonly now: () => string };

/** The alert state this process keeps itself (`alert-recorder.ts`). */
export type LocalAlertState = {
  readonly limiterUnavailableSince: () => string | null;
};

const earlierOf = (left: string | null, right: string | null) =>
  left === null || (right !== null && right < left) ? right : left;

const HTTP_TOTAL_KEY = (bucket: number) => `alert-http-total-${bucket}`;
const HTTP_5XX_KEY = (bucket: number) => `alert-http-5xx-${bucket}`;
const MAIL_SHED_KEY = (bucket: number) => `alert-mail-shed-${bucket}`;

/**
 * Reads the durable, bounded-cardinality Redis state `alert-recorder.ts`
 * writes and assembles it into one snapshot `evaluateAlerts` can decide
 * from. Per-minute request buckets (`http.ts`'s `status` field, tapped for
 * `operation` values starting with `auth.`) are summed over the trailing
 * `windowMinutes` window.
 */
export async function readAlertSnapshot({
  redis,
  local,
  clock,
  windowMinutes = ALERT_THRESHOLDS.auth5xxWindowMinutes,
  readTimeoutMs = ALERT_STATE_READ_TIMEOUT_MS,
}: {
  readonly redis: AlertStateRedis;
  readonly local: LocalAlertState;
  readonly clock: AlertClock;
  readonly windowMinutes?: number;
  readonly readTimeoutMs?: number;
}): Promise<AlertSnapshot> {
  const nowIso = clock.now();
  const localLimiterSince = local.limiterUnavailableSince();
  try {
    const read = await readRedisMarkers(
      { get: (key) => withTimeout(redis.get(key), readTimeoutMs) },
      nowIso,
      windowMinutes,
    );
    return {
      ...read,
      limiterUnavailableSinceIso: earlierOf(
        read.limiterUnavailableSinceIso,
        localLimiterSince,
      ),
    };
  } catch {
    // The limiter shares this Redis: its outage must still be reportable
    // from what this process saw (ISSUE-191).
    return {
      nowIso,
      redisState: 'unreachable',
      storageUnavailableSinceIso: null,
      limiterUnavailableSinceIso: localLimiterSince,
      deliveryConsecutiveFailures: 0,
      authRequests: { total: 0, serverErrors: 0, windowMinutes },
      retentionLastSuccessIso: null,
      mailShed: {
        count: 0,
        windowMinutes: ALERT_THRESHOLDS.mailShedWindowMinutes,
      },
    };
  }
}

async function readRedisMarkers(
  redis: AlertStateRedis,
  nowIso: string,
  windowMinutes: number,
): Promise<AlertSnapshot> {
  const currentBucket = Math.floor(Date.parse(nowIso) / MINUTE_MS);
  const trailing = (minutes: number) =>
    Array.from({ length: minutes }, (_, index) => currentBucket - index);
  const buckets = trailing(windowMinutes);
  const shedBuckets = trailing(ALERT_THRESHOLDS.mailShedWindowMinutes);
  const [
    storageSince,
    limiterSince,
    mailFailures,
    retentionLastSuccess,
    shedValues,
    ...bucketValues
  ] = await Promise.all([
    redis.get('alert-unavailable-storage'),
    redis.get('alert-unavailable-limiter'),
    redis.get('alert-mail-consecutive-failures'),
    redis.get('alert-retention-last-success'),
    Promise.all(shedBuckets.map((bucket) => redis.get(MAIL_SHED_KEY(bucket)))),
    ...buckets.flatMap((bucket) => [
      redis.get(HTTP_TOTAL_KEY(bucket)),
      redis.get(HTTP_5XX_KEY(bucket)),
    ]),
  ]);
  let total = 0;
  let serverErrors = 0;
  for (let index = 0; index < bucketValues.length; index += 2) {
    total += Number(bucketValues[index] ?? 0);
    serverErrors += Number(bucketValues[index + 1] ?? 0);
  }
  return {
    nowIso,
    redisState: 'read',
    storageUnavailableSinceIso: storageSince,
    limiterUnavailableSinceIso: limiterSince,
    deliveryConsecutiveFailures: Number(mailFailures ?? 0),
    authRequests: { total, serverErrors, windowMinutes },
    retentionLastSuccessIso: retentionLastSuccess,
    mailShed: {
      count: shedValues.reduce((sum, value) => sum + Number(value ?? 0), 0),
      windowMinutes: ALERT_THRESHOLDS.mailShedWindowMinutes,
    },
  };
}
