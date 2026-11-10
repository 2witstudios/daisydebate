import { SERVICE_LEASE_WINDOW_MS } from '@daisy/db/service-lease-lapse';

/** How often the instance renews its lease, and checks its own health. */
export const RENEW_INTERVAL_MS = 1000;
/**
 * How long the lease may go unproven before the instance tells anyone: past
 * the 3 s window and any one transaction's budget, so a lapse the next
 * renewal clears never reaches a person (DAISY-WEB-9).
 */
const PERSIST_MS = 10_000;
/**
 * The fewest ms between two deliveries on one channel (the log line or the
 * error tracker), unless the lease has recovered in between, so a lapse that
 * lasts, or one that flaps, cannot flood either.
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
  /** The latest renewal wrote the row only after its window had passed. */
  | { readonly kind: 'renewal_late' }
  | { readonly kind: 'renewal_failed'; readonly error: unknown }
  /**
   * The process did not run its renewals in time (a stalled timer or event
   * loop): the lease lapsed with no renewal hung and none failing.
   */
  | { readonly kind: 'process_stalled' };

/** How the latest settled renewal failed to prove the lease, if it did. */
type Settled = Extract<
  Unproven,
  { readonly kind: 'renewal_late' | 'renewal_failed' }
> | null;

/** One delivery channel's latest delivery since the lease last recovered. */
type Delivered = {
  readonly logMs: number | null;
  readonly reportMs: number | null;
};

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
  /** Monotonic ms of the previous check, to tell a stalled process. */
  readonly checkedMs: number;
  /** Whether the process stalled since the lease was last proven. */
  readonly stalled: boolean;
  readonly delivered: Delivered;
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

/** The channels a persisting lapse is now due on. */
export type LeaseLapseDue = {
  readonly lapse: LeaseLapse;
  readonly log: boolean;
  readonly report: boolean;
};

const nothingDelivered: Delivered = { logMs: null, reportMs: null };

/** A process starts with its lease to prove, from the moment it starts. */
export const startingLease = (nowMs: number): LeaseHealth => ({
  currentUntilMs: nowMs,
  settled: null,
  inFlightSinceMs: null,
  checkedMs: nowMs,
  stalled: false,
  delivered: nothingDelivered,
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
    return { ...done, settled: { kind: 'renewal_late' } };
  return {
    ...done,
    currentUntilMs: Math.max(health.currentUntilMs, provenUntilMs),
    settled: null,
  };
}

/** Why the lease is unproven at `nowMs`, on a check that follows another. */
const unprovenAt = (health: LeaseHealth, nowMs: number): Unproven => {
  if (health.stalled) return { kind: 'process_stalled' };
  if (
    health.inFlightSinceMs !== null &&
    nowMs - health.inFlightSinceMs >= SERVICE_LEASE_WINDOW_MS
  )
    return { kind: 'renewal_pending' };
  // No hung renewal and no settled failure: for most of a lapse this long,
  // no renewal ran at all, so the process itself stalled.
  return health.settled ?? { kind: 'process_stalled' };
};

const isDue = (deliveredMs: number | null, nowMs: number) =>
  deliveredMs === null || nowMs - deliveredMs >= REPEAT_MS;

/**
 * The tick's check at `nowMs`: the health, and the channels a persisting
 * lapse is due on. Nothing counts as delivered here: the caller marks each
 * channel with `delivered` only once it actually went out.
 */
export function checkLease(
  health: LeaseHealth,
  nowMs: number,
): { readonly health: LeaseHealth; readonly due: LeaseLapseDue | null } {
  const checked = { ...health, checkedMs: nowMs };
  const lapsedMs = nowMs - health.currentUntilMs;
  if (lapsedMs < 0) {
    const provenSinceMs = health.provenSinceMs ?? nowMs;
    return {
      health: {
        ...checked,
        stalled: false,
        provenSinceMs,
        delivered:
          nowMs - provenSinceMs >= RECOVERED_MS
            ? nothingDelivered
            : health.delivered,
      },
      due: null,
    };
  }
  const unrecovered = { ...checked, provenSinceMs: null };
  // Just resumed from a stall: this tick's renewal has not even started, so
  // give it the chance to prove the lease before anyone is told, and name
  // the stall if it cannot.
  if (nowMs - health.checkedMs >= SERVICE_LEASE_WINDOW_MS)
    return { health: { ...unrecovered, stalled: true }, due: null };
  const log = isDue(health.delivered.logMs, nowMs);
  const report = isDue(health.delivered.reportMs, nowMs);
  return lapsedMs >= PERSIST_MS && (log || report)
    ? {
        health: unrecovered,
        due: {
          lapse: { lapsedMs, unproven: unprovenAt(health, nowMs) },
          log,
          report,
        },
      }
    : { health: unrecovered, due: null };
}

/** The health once a channel delivered a lapse at `nowMs`. */
export const delivered = (
  health: LeaseHealth,
  channel: 'log' | 'report',
  nowMs: number,
): LeaseHealth => ({
  ...health,
  delivered: {
    ...health.delivered,
    [channel === 'log' ? 'logMs' : 'reportMs']: nowMs,
  },
});
