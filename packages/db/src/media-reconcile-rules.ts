import { createAppError } from '@daisy/errors';
import type {
  MediaReconcileFence,
  MediaVendorIntent,
} from './media-reconcile-contracts';

export const MEDIA_RECONCILE_LEASE_MS = 15_000;
const MIN_RECONCILE_MS = 500;
// The ISO database clock rounds down to milliseconds; preserve the full minimum interval.
const CLOCK_PRECISION_MS = 1;

/**
 * A reconcile holds the session only while its owner's lease is unexpired at
 * `now`, the database clock; an aborted run's owner blocks nothing.
 */
export const reconcileLive = <
  S extends {
    readonly reconcileOwner: string | null;
    readonly reconcileLeaseUntil: Date | null;
  },
>(
  session: S,
  now: Date,
): session is S & { readonly reconcileLeaseUntil: Date } =>
  session.reconcileOwner !== null &&
  session.reconcileLeaseUntil !== null &&
  session.reconcileLeaseUntil > now;

/**
 * Wait for a live owner and the minimum interval since the last run, else
 * claim the next epoch; outstanding vendor work makes the session unsafe.
 */
export function reconcileClaim(
  session: {
    readonly reconcileOwner: string | null;
    readonly reconcileLeaseUntil: Date | null;
    readonly reconcileStartedAt: Date | null;
    readonly reconcileEpoch: number;
    readonly reconcileRequestVersion: number;
    readonly unsafeAt: Date | null;
  },
  now: Date,
  outstanding: boolean,
) {
  if (reconcileLive(session, now))
    return {
      kind: 'wait' as const,
      retryAt: session.reconcileLeaseUntil.toISOString(),
    };
  const earliest =
    (session.reconcileStartedAt?.getTime() ?? -Infinity) +
    MIN_RECONCILE_MS +
    CLOCK_PRECISION_MS;
  if (now.getTime() < earliest)
    return {
      kind: 'wait' as const,
      retryAt: new Date(earliest).toISOString(),
    };
  return {
    kind: 'claim' as const,
    epoch: session.reconcileEpoch + 1,
    leaseUntil: new Date(now.getTime() + MEDIA_RECONCILE_LEASE_MS),
    runningVersion: session.reconcileRequestVersion,
    unsafeAt: session.unsafeAt ?? (outstanding ? now : null),
  };
}

/** Only the current owner and epoch act, and only inside a live lease. */
export function requireReconcileLease(
  session: {
    readonly reconcileOwner: string | null;
    readonly reconcileEpoch: number;
    readonly reconcileLeaseUntil: Date | null;
  },
  claim: MediaReconcileFence,
  now: Date,
) {
  if (
    session.reconcileOwner !== claim.owner ||
    session.reconcileEpoch !== claim.epoch ||
    !session.reconcileLeaseUntil ||
    session.reconcileLeaseUntil <= now
  )
    throw createAppError('CONFLICT', 'Media reconciliation lease changed');
}

/** Unresolved vendor state admits only teardown, never wider access. */
export function requireMutationAdmissible(
  session: { readonly unsafeAt: Date | null },
  outstanding: number,
  kind: MediaVendorIntent['kind'],
) {
  if ((session.unsafeAt || outstanding) && kind !== 'delete')
    throw createAppError('CONFLICT', 'Media recovery is unresolved');
}

/**
 * Release the lease and serve the running version. A terminal session
 * requests deletion; only a matching absence proof clears unsafe and ends it.
 * A proven-clean recovery of an open Round also clears the room deletion
 * request, ending the unsafe episode so capture discovery resumes (ISSUE-465).
 */
export function reconcileCompletion(
  session: {
    readonly reconcileRunningVersion: number;
    readonly endedAt: Date | null;
    readonly deletionRequestedAt: Date | null;
    readonly unsafeAt: Date | null;
  },
  now: Date,
  outcome: {
    readonly terminal: boolean;
    readonly unresolved: boolean;
    readonly cleaned: boolean;
  },
) {
  const { terminal, unresolved, cleaned } = outcome;
  return {
    fields: {
      reconcileOwner: null,
      reconcileLeaseUntil: null,
      reconcileCompletedAt: now,
      reconcileServedVersion: session.reconcileRunningVersion,
      ...(cleaned
        ? {
            unsafeAt: null,
            ...(terminal
              ? { endedAt: session.endedAt ?? now }
              : { deletionRequestedAt: null }),
          }
        : {}),
      ...(terminal
        ? { deletionRequestedAt: session.deletionRequestedAt ?? now }
        : {}),
    },
    result: {
      safe: !unresolved && (session.unsafeAt === null || cleaned),
      ended: terminal && cleaned,
    },
  };
}
