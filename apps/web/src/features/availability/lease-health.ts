import { SERVICE_LEASE_WINDOW_MS } from '@daisy/db/service-lease-lapse';

/** How often the instance renews its lease, and checks its own health. */
export const RENEW_INTERVAL_MS = 1000;
/**
 * The slowest renewal that keeps the lease continuously current: the next
 * one starts within a tick of this one settling, so a renewal slower than
 * the window less a tick may leave its lease stale before the next stamp.
 */
const TIMELY_RENEWAL_MS = SERVICE_LEASE_WINDOW_MS - RENEW_INTERVAL_MS;
/**
 * How long the lease may go unproven before the instance reports it: past
 * the 3 s window and any one transaction's budget, so a lapse the next
 * renewal clears never reaches the error tracker (DAISY-WEB-9).
 */
const PERSIST_MS = 10_000;
/** How often a lapse that lasts is reported again. */
const REPEAT_MS = 5 * 60_000;

/**
 * What this web instance can prove about its own service lease, from its
 * renewals alone. A timely renewal was stamped no earlier than its call, so
 * the lease is proven current until that call plus the window.
 */
export type LeaseHealth = {
  /** Monotonic ms until which the lease is proven current. */
  readonly currentUntilMs: number;
  /** The latest renewal failure since the lease was last proven, if any. */
  readonly lastFailure: unknown;
  /** Monotonic ms of the latest report of the current lapse, if any. */
  readonly reportedAtMs: number | null;
};

export type LeaseRenewal =
  /** A renewal succeeded `tookMs` after it was called. */
  | { readonly kind: 'renewed'; readonly tookMs: number }
  | { readonly kind: 'failed'; readonly error: unknown };

/** A lapse that persisted: how long the lease has been unproven, and why. */
export type LeaseLapse = {
  readonly lapsedMs: number;
  readonly lastFailure: unknown;
};

/** A process starts with its lease to prove, from the moment it starts. */
export const startingLease = (nowMs: number): LeaseHealth => ({
  currentUntilMs: nowMs,
  lastFailure: undefined,
  reportedAtMs: null,
});

/** The health after one renewal settled at `nowMs`. Pure and total. */
export function afterRenewal(
  health: LeaseHealth,
  renewal: LeaseRenewal,
  nowMs: number,
): LeaseHealth {
  if (renewal.kind === 'failed')
    return { ...health, lastFailure: renewal.error };
  if (renewal.tookMs >= TIMELY_RENEWAL_MS) return health;
  const currentUntilMs = Math.max(
    health.currentUntilMs,
    nowMs - renewal.tookMs + SERVICE_LEASE_WINDOW_MS,
  );
  return { currentUntilMs, lastFailure: undefined, reportedAtMs: null };
}

/** The tick's check at `nowMs`: the health, and a lapse to report, if due. */
export function checkLease(
  health: LeaseHealth,
  nowMs: number,
): { readonly health: LeaseHealth; readonly lapse: LeaseLapse | null } {
  const lapsedMs = nowMs - health.currentUntilMs;
  const due =
    lapsedMs >= PERSIST_MS &&
    (health.reportedAtMs === null || nowMs - health.reportedAtMs >= REPEAT_MS);
  return due
    ? {
        health: { ...health, reportedAtMs: nowMs },
        lapse: { lapsedMs, lastFailure: health.lastFailure },
      }
    : { health, lapse: null };
}
