import { withTimeout } from '@daisy/observability';
import type { ScheduledWorkerName } from './scheduled-worker';

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
  /**
   * AUTH-3.10: magic-link requests denied for their network (IPv6 /56 or
   * /48, IPv4 /24) over the trailing window. A network over its limit is
   * already refused, so this is for operators to see a flood, not to stop
   * it: 300 in 10 minutes is more than a busy shared network trips by
   * accident (each allows 30 to 120 a minute) and far less than a single
   * /48 flooding at full rate (about 196,000 a minute).
   */
  networkDeniedWindowMinutes: 10,
  networkDeniedCount: 300,
} as const;

/** Every marker was read, so every condition can be evaluated. */
type ReadAlertSnapshot = {
  readonly nowIso: string;
  readonly redisState: 'read';
  readonly storageUnavailableSinceIso: string | null;
  readonly limiterUnavailableSinceIso: string | null;
  readonly deliveryConsecutiveFailures: number;
  readonly authRequests: {
    readonly total: number;
    readonly serverErrors: number;
    readonly windowMinutes: number;
  };
  readonly retentionLastSuccessIso: string | null;
  /** The workers this process runs, each with its last healthy run. */
  readonly workers: readonly {
    readonly name: ScheduledWorkerName;
    readonly missedAfterMs: number;
    readonly lastSuccessIso: string | null;
  }[];
  /** `mail.shed` events over the trailing window (ISSUE-220). */
  readonly mailShed: {
    readonly count: number;
    readonly windowMinutes: number;
  };
  /** `auth.rate_limit.network_denied` events over the trailing window (AUTH-3.10). */
  readonly networkDenied: {
    readonly count: number;
    readonly windowMinutes: number;
  };
};

/**
 * Redis could not be read, so no marker exists to judge: only what this
 * process saw itself remains (ISSUE-191).
 */
type UnreadAlertSnapshot = {
  readonly nowIso: string;
  readonly redisState: 'unreachable';
  readonly limiterUnavailableSinceIso: string | null;
};

export type AlertSnapshot = ReadAlertSnapshot | UnreadAlertSnapshot;

const WORKER_ALERT_IDS = {
  observation_purges: 'observation_purges_missed',
  privacy_jobs: 'privacy_jobs_missed',
  messaging_file_maintenance: 'file_maintenance_missed',
} as const satisfies Record<ScheduledWorkerName, string>;
type WorkerAlertId = (typeof WORKER_ALERT_IDS)[ScheduledWorkerName];

type AlertConditionId =
  | 'storage_unavailable'
  | 'limiter_unavailable'
  | 'delivery_failures'
  | 'auth_5xx_rate'
  | 'cleanup_missed'
  | WorkerAlertId
  | 'mail_shed'
  | 'network_limited';

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
  observation_purges_missed: '#scheduled-worker-missed',
  privacy_jobs_missed: '#scheduled-worker-missed',
  file_maintenance_missed: '#scheduled-worker-missed',
  mail_shed: '#auth-mail-shed-past-the-bound',
  network_limited: '#magic-link-requests-limited-per-network',
} as const satisfies Record<AlertConditionId, string>;

const runbook = (id: AlertConditionId) =>
  `docs/operations/auth-delivery.md${RUNBOOK_ANCHOR[id]}`;

const elapsedMs = (sinceIso: string, nowIso: string): number =>
  Date.parse(nowIso) - Date.parse(sinceIso);

const checkStorageUnavailable = (
  snapshot: ReadAlertSnapshot,
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
  snapshot: Pick<AlertSnapshot, 'nowIso' | 'limiterUnavailableSinceIso'>,
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
  snapshot: ReadAlertSnapshot,
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
  snapshot: ReadAlertSnapshot,
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
  snapshot: ReadAlertSnapshot,
): AlertCondition | undefined =>
  snapshot.retentionLastSuccessIso === null ||
  elapsedMs(snapshot.retentionLastSuccessIso, snapshot.nowIso) >=
    ALERT_THRESHOLDS.retentionMissedMs
    ? {
        id: 'cleanup_missed',
        summary:
          snapshot.retentionLastSuccessIso === null
            ? 'No retention run has succeeded on every target'
            : `Last retention run to succeed on every target: ${snapshot.retentionLastSuccessIso}`,
        runbook: runbook('cleanup_missed'),
      }
    : undefined;

/** ISSUE-1007: each running worker against its own marker and threshold. */
const missedWorkers = (
  snapshot: ReadAlertSnapshot,
): readonly AlertCondition[] =>
  snapshot.workers
    .filter(
      ({ lastSuccessIso, missedAfterMs }) =>
        lastSuccessIso === null ||
        elapsedMs(lastSuccessIso, snapshot.nowIso) >= missedAfterMs,
    )
    .map(({ name, lastSuccessIso }) => ({
      id: WORKER_ALERT_IDS[name],
      summary:
        lastSuccessIso === null
          ? `Worker ${name} has not had a healthy run`
          : `Worker ${name} last healthy ${lastSuccessIso}`,
      runbook: runbook(WORKER_ALERT_IDS[name]),
    }));

const checkMailShed = (
  snapshot: ReadAlertSnapshot,
): AlertCondition | undefined =>
  snapshot.mailShed.count >= ALERT_THRESHOLDS.mailShedCount
    ? {
        id: 'mail_shed',
        summary: `${snapshot.mailShed.count} handed-off auth mail tasks shed in ${snapshot.mailShed.windowMinutes}m: sign-in and sign-up mail is being dropped`,
        runbook: runbook('mail_shed'),
      }
    : undefined;

const checkNetworkLimited = (
  snapshot: ReadAlertSnapshot,
): AlertCondition | undefined =>
  snapshot.networkDenied.count >= ALERT_THRESHOLDS.networkDeniedCount
    ? {
        id: 'network_limited',
        summary: `${snapshot.networkDenied.count} magic-link requests denied for their network in ${snapshot.networkDenied.windowMinutes}m: one network is flooding sign-in`,
        runbook: runbook('network_limited'),
      }
    : undefined;

type AlertCheck = (snapshot: ReadAlertSnapshot) => AlertCondition | undefined;

const ALERT_CHECKS: readonly AlertCheck[] = [
  checkStorageUnavailable,
  checkLimiterUnavailable,
  checkDeliveryFailures,
  checkAuth5xxRate,
  checkCleanupMissed,
  checkMailShed,
  checkNetworkLimited,
];

const OBSERVATION_PURGES_MISSED_MS = 15 * MINUTE_MS;
const WORKER_MISSED_FLOOR_MS = 2 * 60 * MINUTE_MS;

/**
 * The workers a process runs, each given longer than its backoff ceiling
 * (observation purges 5 minutes, privacy jobs an hour) so one retry never
 * fires. File maintenance runs only when configured, and at any interval, so
 * it also gets three of its own intervals.
 */
export const runningWorkers = (input: {
  readonly fileMaintenanceIntervalMs: number | null;
}): readonly RunningWorker[] => [
  { name: 'observation_purges', missedAfterMs: OBSERVATION_PURGES_MISSED_MS },
  { name: 'privacy_jobs', missedAfterMs: WORKER_MISSED_FLOOR_MS },
  ...(input.fileMaintenanceIntervalMs === null
    ? []
    : [
        {
          name: 'messaging_file_maintenance' as const,
          missedAfterMs: Math.max(
            WORKER_MISSED_FLOOR_MS,
            3 * input.fileMaintenanceIntervalMs,
          ),
        },
      ]),
];

/**
 * The alert conditions, evaluated from a snapshot the caller
 * already read (`readAlertSnapshot`). Pure: every threshold and duration
 * decision is a function of the inputs, so this is fully testable without
 * Redis, a clock, or the network.
 */
export function evaluateAlerts(
  snapshot: AlertSnapshot,
): readonly AlertCondition[] {
  const fired = (conditions: readonly (AlertCondition | undefined)[]) =>
    conditions.filter(
      (condition): condition is AlertCondition => condition !== undefined,
    );
  if (snapshot.redisState === 'unreachable')
    return fired([checkLimiterUnavailable(snapshot)]);
  return [
    ...fired(ALERT_CHECKS.map((check) => check(snapshot))),
    ...missedWorkers(snapshot),
  ];
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
const NETWORK_DENIED_KEY = (bucket: number) => `alert-network-denied-${bucket}`;
/** One worker's last healthy run, written by `alert-recorder.ts`. */
export const workerSuccessKey = (name: ScheduledWorkerName) =>
  `alert-worker-last-success-${name}`;

/** A worker this process runs, and how long it may go without a healthy run. */
export type RunningWorker = {
  readonly name: ScheduledWorkerName;
  readonly missedAfterMs: number;
};

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
  workers,
  windowMinutes = ALERT_THRESHOLDS.auth5xxWindowMinutes,
  readTimeoutMs = ALERT_STATE_READ_TIMEOUT_MS,
}: {
  readonly redis: AlertStateRedis;
  readonly local: LocalAlertState;
  readonly clock: AlertClock;
  readonly workers: readonly RunningWorker[];
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
      workers,
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
      limiterUnavailableSinceIso: localLimiterSince,
    };
  }
}

const sumOf = (values: readonly (string | null)[]) =>
  values.reduce((sum, value) => sum + Number(value ?? 0), 0);

async function readRedisMarkers(
  redis: AlertStateRedis,
  nowIso: string,
  windowMinutes: number,
  workers: readonly RunningWorker[],
): Promise<ReadAlertSnapshot> {
  const currentBucket = Math.floor(Date.parse(nowIso) / MINUTE_MS);
  const trailing = (minutes: number) =>
    Array.from({ length: minutes }, (_, index) => currentBucket - index);
  const buckets = trailing(windowMinutes);
  const shedBuckets = trailing(ALERT_THRESHOLDS.mailShedWindowMinutes);
  const networkBuckets = trailing(ALERT_THRESHOLDS.networkDeniedWindowMinutes);
  const [
    storageSince,
    limiterSince,
    mailFailures,
    retentionLastSuccess,
    workerValues,
    shedValues,
    networkValues,
    ...bucketValues
  ] = await Promise.all([
    redis.get('alert-unavailable-storage'),
    redis.get('alert-unavailable-limiter'),
    redis.get('alert-mail-consecutive-failures'),
    redis.get('alert-retention-last-success'),
    Promise.all(workers.map(({ name }) => redis.get(workerSuccessKey(name)))),
    Promise.all(shedBuckets.map((bucket) => redis.get(MAIL_SHED_KEY(bucket)))),
    Promise.all(
      networkBuckets.map((bucket) => redis.get(NETWORK_DENIED_KEY(bucket))),
    ),
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
    workers: workers.map((worker, index) => ({
      ...worker,
      lastSuccessIso: workerValues[index] ?? null,
    })),
    mailShed: {
      count: sumOf(shedValues),
      windowMinutes: ALERT_THRESHOLDS.mailShedWindowMinutes,
    },
    networkDenied: {
      count: sumOf(networkValues),
      windowMinutes: ALERT_THRESHOLDS.networkDeniedWindowMinutes,
    },
  };
}
