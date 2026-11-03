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
      reason: 'lease' as const,
      retryAt: session.reconcileLeaseUntil.toISOString(),
    };
  const earliest =
    (session.reconcileStartedAt?.getTime() ?? -Infinity) +
    MIN_RECONCILE_MS +
    CLOCK_PRECISION_MS;
  if (now.getTime() < earliest)
    return {
      kind: 'wait' as const,
      reason: 'interval' as const,
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
 * How long an unknown vendor outcome holds a room: past the 5 s the adapter waits on one
 * call, so a live node's blip has answered. It is not a bound on the provider: a delete's
 * reclaim can make three calls, so a late create can still leave an empty room under the
 * retired name, which closes itself by `empty_timeout`.
 */
export const MEDIA_ROOM_RETIRE_AFTER_MS = 6_000;

/** What this pass decided about the session's vendor room (ADR 0110). */
export type RoomDecision =
  | { readonly kind: 'keep' }
  | {
      readonly kind: 'retire';
      /** `unreachable` retires a room that may still be live. */
      readonly cause: 'absent' | 'unreachable';
      /** Its state was unknown, so it is left behind even with every seat eligible. */
      readonly uncertain: boolean;
    };

/**
 * The one decision. Observed absence retires at once. Otherwise uncertainty older than
 * the bound retires an open Round's room with the node still silent, because a late
 * outcome can only reach a name no token uses. A terminal session waits for proof, since
 * ending it stops every later delete attempt.
 */
export function decideRoom(input: {
  readonly now: Date;
  readonly terminal: boolean;
  readonly absenceProven: boolean;
  readonly unsafeAt: Date | null;
  readonly oldestPendingAt: Date | null;
}): RoomDecision {
  const since = [input.unsafeAt, input.oldestPendingAt].flatMap((at) =>
    at ? [at.getTime()] : [],
  );
  const uncertain = since.length > 0;
  if (input.absenceProven)
    return { kind: 'retire', cause: 'absent', uncertain };
  if (
    uncertain &&
    !input.terminal &&
    input.now.getTime() - Math.min(...since) >= MEDIA_ROOM_RETIRE_AFTER_MS
  )
    return { kind: 'retire', cause: 'unreachable', uncertain };
  return { kind: 'keep' };
}

/**
 * Release the lease and serve the running version. A terminal session requests
 * deletion and ends only when its room is retired, which for it means proven absent.
 * Retiring an open Round's room also clears the deletion request, ending the unsafe
 * episode so capture discovery resumes (ISSUE-465).
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
    /** Vendor work still pending after this pass's decision. */
    readonly unresolved: boolean;
    readonly decision: RoomDecision;
    /** The pass finished its work; a failed one leaves the Round due to the tick. */
    readonly clean: boolean;
  },
) {
  const { terminal, unresolved, decision, clean } = outcome;
  const retired = decision.kind === 'retire';
  return {
    fields: {
      reconcileOwner: null,
      reconcileLeaseUntil: null,
      reconcileCompletedAt: now,
      reconcileLastPassClean: clean,
      reconcileServedVersion: session.reconcileRunningVersion,
      ...(retired
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
      safe: !unresolved && (session.unsafeAt === null || retired),
      ended: terminal && retired,
    },
  };
}
