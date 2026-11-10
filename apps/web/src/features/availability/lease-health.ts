import { SERVICE_LEASE_WINDOW_MS } from '@daisy/db/service-lease-lapse';

/** How often the instance renews its lease, and checks its own health. */
export const RENEW_INTERVAL_MS = 1000;
/**
 * How long the lease may go unproven before the streak is told, once: past
 * the 3 s window and any one transaction's budget, so a lapse a renewal
 * clears within this bound never reaches a person (DAISY-WEB-9). A process
 * frozen past it really went unproven that long, and is told once.
 */
const PERSIST_MS = 10_000;

/** Why the lease is not proven. */
export type Unproven =
  /** No renewal has settled since the lease was last proven. */
  | { readonly kind: 'renewal_pending' }
  /** The latest renewal wrote the row only after its window had passed. */
  | { readonly kind: 'renewal_late' }
  | { readonly kind: 'renewal_failed'; readonly error: unknown };

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
  readonly unproven: Unproven;
  /** Which channels this streak has told; a proving renewal re-arms both. */
  readonly told: { readonly log: boolean; readonly report: boolean };
};

export type LeaseRenewal =
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

/** The channels a persisting streak still owes. */
export type LeaseLapseDue = {
  readonly lapse: LeaseLapse;
  readonly log: boolean;
  readonly report: boolean;
};

const untold = { log: false, report: false } as const;

/** A process starts with its lease to prove, from the moment it starts. */
export const startingLease = (nowMs: number): LeaseHealth => ({
  currentUntilMs: nowMs,
  unproven: { kind: 'renewal_pending' },
  told: untold,
});

/** The health after one settled renewal. Pure and total. */
export function afterRenewal(
  health: LeaseHealth,
  renewal: LeaseRenewal,
): LeaseHealth {
  if (renewal.kind === 'failed')
    return {
      ...health,
      unproven: { kind: 'renewal_failed', error: renewal.error },
    };
  const provenUntilMs = renewal.startedMs + SERVICE_LEASE_WINDOW_MS;
  if (renewal.settledMs >= provenUntilMs)
    return { ...health, unproven: { kind: 'renewal_late' } };
  // The lease is proven current again: the streak ends and re-arms.
  return {
    currentUntilMs: Math.max(health.currentUntilMs, provenUntilMs),
    unproven: { kind: 'renewal_pending' },
    told: untold,
  };
}

/**
 * The tick's check at `nowMs`: the channels a streak unproven past the bound
 * still owes, if any. One report per streak; the caller marks a channel with
 * `delivered` only once it went out, so a failed send is tried again.
 */
export function checkLease(
  health: LeaseHealth,
  nowMs: number,
): LeaseLapseDue | null {
  const lapsedMs = nowMs - health.currentUntilMs;
  if (lapsedMs < PERSIST_MS || (health.told.log && health.told.report))
    return null;
  return {
    lapse: { lapsedMs, unproven: health.unproven },
    log: !health.told.log,
    report: !health.told.report,
  };
}

/** The health once a channel told this streak. */
export const delivered = (
  health: LeaseHealth,
  channel: 'log' | 'report',
): LeaseHealth => ({ ...health, told: { ...health.told, [channel]: true } });
