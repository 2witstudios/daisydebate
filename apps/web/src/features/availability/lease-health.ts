import { SERVICE_LEASE_WINDOW_MS } from '@daisy/db/service-lease-lapse';

/** How often the instance renews its lease, and checks its own health. */
export const RENEW_INTERVAL_MS = 1000;
/**
 * How long the lease may go unproven before the instance reports it: past
 * the 3 s window and any one transaction's budget, so a lapse the next
 * renewal clears never reaches the error tracker (DAISY-WEB-9).
 */
const PERSIST_MS = 10_000;
/**
 * The fewest ms between two reports from one instance, unless the lease has
 * recovered in between, so a lapse that lasts, or one that flaps, cannot
 * flood the tracker.
 */
const REPEAT_MS = 5 * 60_000;
/**
 * How long the lease must stay proven before a recovery counts: a flapping
 * lease never stays proven this long, while a separate later outage, after
 * a real recovery, reports even within five minutes of the last report.
 */
const RECOVERED_MS = 30_000;

/** Why the lease is not proven. */
export type Unproven =
  /** A renewal has been in flight for the whole window. */
  | { readonly kind: 'renewal_pending' }
  /**
   * No renewal was hung and the last settled one proved the lease: the
   * process did not start one in time (a stalled timer or event loop).
   */
  | { readonly kind: 'renewal_not_started' }
  /** The latest renewal wrote the row only after its window had passed. */
  | { readonly kind: 'renewal_late'; readonly tookMs: number }
  | { readonly kind: 'renewal_failed'; readonly error: unknown };

/** How the latest settled renewal failed to prove the lease, if it did. */
type Settled = Extract<
  Unproven,
  { readonly kind: 'renewal_late' | 'renewal_failed' }
> | null;

/**
 * What this web instance can prove about its own service lease, from its
 * renewals alone. A renewal called at `startedMs` and settled at `settledMs`
 * was stamped between the two and visible from the settle, so it proves the
 * lease current from its settle until its call plus the window. One that
 * settled after that proves nothing, since its stamp may be stale by the
 * time it is visible.
 */
export type LeaseHealth = {
  /** Monotonic ms until which the lease is proven current. */
  readonly currentUntilMs: number;
  readonly settled: Settled;
  /** Monotonic ms the renewal now in flight started, if one is. */
  readonly inFlightSinceMs: number | null;
  /** Monotonic ms of this instance's latest report since it last recovered. */
  readonly reportedAtMs: number | null;
  /** Monotonic ms since which every check has found the lease proven. */
  readonly provenSinceMs: number | null;
};

export type LeaseRenewal =
  | { readonly kind: 'started'; readonly startedMs: number }
  /** A renewal called at `startedMs` wrote the lease row by `settledMs`. */
  | {
      readonly kind: 'renewed';
      readonly startedMs: number;
      readonly settledMs: number;
    }
  | { readonly kind: 'failed'; readonly error: unknown };

/** A lapse that persisted: how long the lease has been unproven, and why. */
export type LeaseLapse = {
  readonly lapsedMs: number;
  readonly unproven: Unproven;
};

/** A process starts with its lease to prove, from the moment it starts. */
export const startingLease = (nowMs: number): LeaseHealth => ({
  currentUntilMs: nowMs,
  settled: null,
  inFlightSinceMs: null,
  reportedAtMs: null,
  provenSinceMs: null,
});

/** The health after one renewal event. Pure and total. */
export function afterRenewal(
  health: LeaseHealth,
  renewal: LeaseRenewal,
): LeaseHealth {
  if (renewal.kind === 'started')
    return { ...health, inFlightSinceMs: renewal.startedMs };
  const done = { ...health, inFlightSinceMs: null };
  if (renewal.kind === 'failed')
    return {
      ...done,
      settled: { kind: 'renewal_failed', error: renewal.error },
    };
  const provenUntilMs = renewal.startedMs + SERVICE_LEASE_WINDOW_MS;
  if (renewal.settledMs >= provenUntilMs)
    return {
      ...done,
      settled: {
        kind: 'renewal_late',
        tookMs: renewal.settledMs - renewal.startedMs,
      },
    };
  return {
    ...done,
    currentUntilMs: Math.max(health.currentUntilMs, provenUntilMs),
    settled: null,
  };
}

/** Why the lease is unproven at `nowMs`: a hung renewal outranks the past. */
const unprovenAt = (health: LeaseHealth, nowMs: number): Unproven => {
  if (
    health.inFlightSinceMs !== null &&
    nowMs - health.inFlightSinceMs >= SERVICE_LEASE_WINDOW_MS
  )
    return { kind: 'renewal_pending' };
  // No hung renewal and no settled failure: for most of a lapse this long,
  // no renewal ran at all (a stalled timer), whatever has started since.
  return health.settled ?? { kind: 'renewal_not_started' };
};

/** The tick's check at `nowMs`: the health, and a lapse to report, if due. */
export function checkLease(
  health: LeaseHealth,
  nowMs: number,
): { readonly health: LeaseHealth; readonly lapse: LeaseLapse | null } {
  const lapsedMs = nowMs - health.currentUntilMs;
  if (lapsedMs < 0) {
    const provenSinceMs = health.provenSinceMs ?? nowMs;
    return {
      health: {
        ...health,
        provenSinceMs,
        reportedAtMs:
          nowMs - provenSinceMs >= RECOVERED_MS ? null : health.reportedAtMs,
      },
      lapse: null,
    };
  }
  const due =
    lapsedMs >= PERSIST_MS &&
    (health.reportedAtMs === null || nowMs - health.reportedAtMs >= REPEAT_MS);
  const unrecovered = { ...health, provenSinceMs: null };
  return due
    ? {
        health: { ...unrecovered, reportedAtMs: nowMs },
        lapse: { lapsedMs, unproven: unprovenAt(health, nowMs) },
      }
    : { health: unrecovered, lapse: null };
}
