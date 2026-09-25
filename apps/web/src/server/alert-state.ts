const MINUTE_MS = 60_000;

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
} as const;

export type AlertSnapshot = {
  readonly nowIso: string;
  readonly storageUnavailableSinceIso: string | null;
  readonly limiterUnavailableSinceIso: string | null;
  readonly deliveryConsecutiveFailures: number;
  readonly authRequests: {
    readonly total: number;
    readonly serverErrors: number;
    readonly windowMinutes: number;
  };
  readonly retentionLastSuccessIso: string | null;
};

type AlertConditionId =
  | 'storage_unavailable'
  | 'limiter_unavailable'
  | 'delivery_failures'
  | 'auth_5xx_rate'
  | 'cleanup_missed';

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

const ALERT_CHECKS: readonly ((
  snapshot: AlertSnapshot,
) => AlertCondition | undefined)[] = [
  checkStorageUnavailable,
  checkLimiterUnavailable,
  checkDeliveryFailures,
  checkAuth5xxRate,
  checkCleanupMissed,
];

/**
 * AUTH-7.7's four alert conditions, evaluated from a snapshot the caller
 * already read (`readAlertSnapshot`). Pure: every threshold and duration
 * decision is a function of the inputs, so this is fully testable without
 * Redis, a clock, or the network.
 */
export function evaluateAlerts(
  snapshot: AlertSnapshot,
): readonly AlertCondition[] {
  return ALERT_CHECKS.map((check) => check(snapshot)).filter(
    (condition): condition is AlertCondition => condition !== undefined,
  );
}

export type AlertStateRedis = {
  readonly get: (key: string) => Promise<string | null>;
};

export type AlertClock = { readonly now: () => string };

const HTTP_TOTAL_KEY = (bucket: number) => `alert-http-total-${bucket}`;
const HTTP_5XX_KEY = (bucket: number) => `alert-http-5xx-${bucket}`;

/**
 * Reads the durable, bounded-cardinality Redis state `alert-recorder.ts`
 * writes and assembles it into one snapshot `evaluateAlerts` can decide
 * from. Per-minute request buckets (`http.ts`'s `status` field, tapped for
 * `operation` values starting with `auth.`) are summed over the trailing
 * `windowMinutes` window.
 */
export async function readAlertSnapshot({
  redis,
  clock,
  windowMinutes = ALERT_THRESHOLDS.auth5xxWindowMinutes,
}: {
  readonly redis: AlertStateRedis;
  readonly clock: AlertClock;
  readonly windowMinutes?: number;
}): Promise<AlertSnapshot> {
  const nowIso = clock.now();
  const currentBucket = Math.floor(Date.parse(nowIso) / MINUTE_MS);
  const buckets = Array.from(
    { length: windowMinutes },
    (_, index) => currentBucket - index,
  );
  const [
    storageSince,
    limiterSince,
    mailFailures,
    retentionLastSuccess,
    ...bucketValues
  ] = await Promise.all([
    redis.get('alert-unavailable-storage'),
    redis.get('alert-unavailable-limiter'),
    redis.get('alert-mail-consecutive-failures'),
    redis.get('alert-retention-last-success'),
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
    storageUnavailableSinceIso: storageSince,
    limiterUnavailableSinceIso: limiterSince,
    deliveryConsecutiveFailures: Number(mailFailures ?? 0),
    authRequests: { total, serverErrors, windowMinutes },
    retentionLastSuccessIso: retentionLastSuccess,
  };
}
