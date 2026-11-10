import { SERVICE_LEASE_WINDOW_MS } from '@daisy/db/service-lease-lapse';

/** How often the instance renews its lease, and checks its own health. */
export const RENEW_INTERVAL_MS = 1000;
/**
 * How long the lease may go unproven before the instance reports it: past
 * the 3 s window and any one transaction's budget, so a lapse the next
 * renewal clears never reaches the error tracker (DAISY-WEB-9).
 */
const PERSIST_MS = 10_000;
/** How often a lapse that lasts is reported again. */
const REPEAT_MS = 5 * 60_000;

/** Why the lease is not proven: what the latest renewal since then is doing. */
export type Unproven =
  | { readonly kind: 'renewal_pending' }
  | { readonly kind: 'renewal_failed'; readonly error: unknown };

/**
 * What this web instance can prove about its own service lease, from its
 * renewals alone. A renewal that succeeds was stamped no earlier than its
 * call, so it proves the lease current until that call plus the window,
 * however long it took to settle.
 */
export type LeaseHealth = {
  /** Monotonic ms until which the lease is proven current. */
  readonly currentUntilMs: number;
  readonly unproven: Unproven;
  /** Monotonic ms of the latest report of the current lapse, if any. */
  readonly reportedAtMs: number | null;
};

export type LeaseRenewal =
  | { readonly kind: 'started' }
  /** A renewal called at `startedMs` wrote this instance's lease row. */
  | { readonly kind: 'renewed'; readonly startedMs: number }
  | { readonly kind: 'failed'; readonly error: unknown };

/** A lapse that persisted: how long the lease has been unproven, and why. */
export type LeaseLapse = {
  readonly lapsedMs: number;
  readonly unproven: Unproven;
};

const pending: Unproven = { kind: 'renewal_pending' };

/** A process starts with its lease to prove, from the moment it starts. */
export const startingLease = (nowMs: number): LeaseHealth => ({
  currentUntilMs: nowMs,
  unproven: pending,
  reportedAtMs: null,
});

/** The health after one renewal event. Pure and total. */
export function afterRenewal(
  health: LeaseHealth,
  renewal: LeaseRenewal,
): LeaseHealth {
  if (renewal.kind === 'started') return { ...health, unproven: pending };
  if (renewal.kind === 'failed')
    return {
      ...health,
      unproven: { kind: 'renewal_failed', error: renewal.error },
    };
  return {
    ...health,
    currentUntilMs: Math.max(
      health.currentUntilMs,
      renewal.startedMs + SERVICE_LEASE_WINDOW_MS,
    ),
  };
}

/** The tick's check at `nowMs`: the health, and a lapse to report, if due. */
export function checkLease(
  health: LeaseHealth,
  nowMs: number,
): { readonly health: LeaseHealth; readonly lapse: LeaseLapse | null } {
  const lapsedMs = nowMs - health.currentUntilMs;
  // Proven current now: any lapse is over, so the next one reports afresh.
  if (lapsedMs < 0)
    return { health: { ...health, reportedAtMs: null }, lapse: null };
  const due =
    lapsedMs >= PERSIST_MS &&
    (health.reportedAtMs === null || nowMs - health.reportedAtMs >= REPEAT_MS);
  return due
    ? {
        health: { ...health, reportedAtMs: nowMs },
        lapse: { lapsedMs, unproven: health.unproven },
      }
    : { health, lapse: null };
}
