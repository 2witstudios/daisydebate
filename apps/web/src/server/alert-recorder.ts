import type { Clock } from '@daisy/clock';
import type { Logger } from '@daisy/logger';

const MINUTE_MS = 60_000;
/** Bridges the 2-minute unavailability threshold across gaps between failures without pinning the incident's start to the most recent one. */
const UNAVAILABLE_MARK_TTL_SECONDS = 180;
/** A quiet hour resets the consecutive-failure count; no legitimate retry cadence needs longer. */
const DELIVERY_FAILURE_WINDOW_SECONDS = 60 * 60;
/** Long-lived on purpose: cleared only by an actual successful sweep, so a multi-hour outage stays visible (ADR: see docs/decisions). */
const RETENTION_SUCCESS_TTL_SECONDS = 30 * 24 * 60 * 60;
/** Outlives the 10-minute read window `alert-state.ts` sums over. */
const HTTP_BUCKET_TTL_SECONDS = 11 * 60;

export type AlertRecorderRedis = {
  readonly setIfAbsent: (
    key: string,
    value: string,
    ttlSeconds: number,
  ) => Promise<string>;
  readonly incrementWithExpiry: (
    key: string,
    ttlSeconds: number,
  ) => Promise<number>;
  readonly delete: (key: string) => Promise<void>;
  readonly setEphemeral: (
    key: string,
    value: string,
    ttlSeconds: number,
  ) => Promise<void>;
};

/** Never lets alert bookkeeping surface an error to the event it observed. */
const swallow = (promise: Promise<unknown>): void => {
  void promise.catch(() => {});
};

/**
 * The two HTTP lifecycle events, scoped to `auth.*` operations with a
 * numeric `status` (bounded cardinality: a small, known operation-name
 * set, never a raw path or identifier).
 */
const recordHttpOutcome = (
  redis: AlertRecorderRedis,
  clock: Clock,
  fields: Readonly<Record<string, unknown>>,
): void => {
  const { operation, status } = fields;
  if (typeof operation !== 'string' || !operation.startsWith('auth.')) return;
  if (typeof status !== 'number') return;
  const bucket = Math.floor(Date.parse(clock.now()) / MINUTE_MS);
  swallow(
    redis.incrementWithExpiry(
      `alert-http-total-${bucket}`,
      HTTP_BUCKET_TTL_SECONDS,
    ),
  );
  if (status >= 500)
    swallow(
      redis.incrementWithExpiry(
        `alert-http-5xx-${bucket}`,
        HTTP_BUCKET_TTL_SECONDS,
      ),
    );
};

/**
 * Derives AUTH-7.7's durable, bounded-cardinality Redis alert state from the
 * structured event stream that already exists — no new call sites, no new
 * event names. `withAlertRecording` below feeds it every event the composed
 * `Logger` emits.
 */
export function createAlertRecorder({
  redis,
  clock,
}: {
  readonly redis: AlertRecorderRedis;
  readonly clock: Clock;
}) {
  return {
    observe(event: string, fields: Readonly<Record<string, unknown>>): void {
      switch (event) {
        case 'auth.session.unavailable':
          swallow(
            redis.setIfAbsent(
              'alert-unavailable-storage',
              clock.now(),
              UNAVAILABLE_MARK_TTL_SECONDS,
            ),
          );
          return;
        case 'auth.rate_limit.unavailable':
          swallow(
            redis.setIfAbsent(
              'alert-unavailable-limiter',
              clock.now(),
              UNAVAILABLE_MARK_TTL_SECONDS,
            ),
          );
          return;
        case 'auth.mail.failed':
          swallow(
            redis.incrementWithExpiry(
              'alert-mail-consecutive-failures',
              DELIVERY_FAILURE_WINDOW_SECONDS,
            ),
          );
          return;
        case 'auth.mail.sent':
          swallow(redis.delete('alert-mail-consecutive-failures'));
          return;
        case 'retention.sweep.completed':
          swallow(
            redis.setEphemeral(
              'alert-retention-last-success',
              clock.now(),
              RETENTION_SUCCESS_TTL_SECONDS,
            ),
          );
          return;
        case 'http.request.completed':
        case 'http.request.failed':
          recordHttpOutcome(redis, clock, fields);
          return;
        default:
          return;
      }
    },
  };
}

export type AlertRecorder = ReturnType<typeof createAlertRecorder>;

/**
 * Wraps a `Logger` so every event it logs — and every event any of its
 * children log — also reaches `recorder.observe` first. The composition
 * root (`app.ts`) applies this once; every existing `logger.log` call site
 * across the app (auth, retention, HTTP) feeds AUTH-7.7's alert state with
 * no per-site change.
 */
export function withAlertRecording(
  logger: Logger,
  recorder: Pick<AlertRecorder, 'observe'>,
): Logger {
  const wrap = (target: Logger): Logger => ({
    log: (event, fields, message) => {
      recorder.observe(event, fields);
      target.log(event, fields, message);
    },
    child: (fields) => wrap(target.child(fields)),
  });
  return wrap(logger);
}
