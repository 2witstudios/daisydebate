import { isAppError } from '@daisy/errors';
import type { ErrorReporter } from '@daisy/observability';

/**
 * How long this instance's lease must stay lapsing before it is reported:
 * past the 3 s lease window and any one transaction's budget, so a lapse the
 * next renewal clears never reaches the error tracker (DAISY-WEB-9).
 */
const PERSIST_MS = 10_000;
/** How often a lapse that lasts is reported again. */
const REPEAT_MS = 5 * 60_000;
/** One error-tracker route for the one instance condition, whatever saw it. */
const ROUTE = 'web.service-lease.lapsed';

/**
 * Whether this web instance's own service lease is current. Its renewals
 * are the truth: a renewal that succeeds makes it current again; a failed
 * renewal or a worker refused for a lapsed lease means it is lapsing.
 */
export type ServiceLeaseState =
  | { readonly kind: 'current' }
  | {
      readonly kind: 'lapsing';
      /** Monotonic ms since the lease stopped being known current. */
      readonly sinceMs: number;
      /** Monotonic ms of the latest report of this lapse, if any. */
      readonly reportedAtMs: number | null;
    };

export type ServiceLeaseSignal = 'renewed' | 'renewal-failed' | 'lapse-refused';

export const currentLease: ServiceLeaseState = { kind: 'current' };

/** The state after one signal at `nowMs`, and whether to report it. Pure and total. */
export function nextServiceLease(
  state: ServiceLeaseState,
  signal: ServiceLeaseSignal,
  nowMs: number,
): { readonly state: ServiceLeaseState; readonly report: boolean } {
  if (signal === 'renewed') return { state: currentLease, report: false };
  const lapsing =
    state.kind === 'lapsing'
      ? state
      : ({ kind: 'lapsing', sinceMs: nowMs, reportedAtMs: null } as const);
  const report =
    nowMs - lapsing.sinceMs >= PERSIST_MS &&
    (lapsing.reportedAtMs === null ||
      nowMs - lapsing.reportedAtMs >= REPEAT_MS);
  return {
    state: report ? { ...lapsing, reportedAtMs: nowMs } : lapsing,
    report,
  };
}

/** This instance's lease health, fed by its renewals and its workers. */
export type ServiceLease = {
  readonly renewed: () => void;
  readonly renewalFailed: (error: unknown) => void;
  readonly lapseRefused: (error: unknown) => void;
};

/**
 * The one lease state of a process, timed by an injected monotonic clock.
 * A report goes to the scrubbed reporter under one fixed route, whichever
 * renewal or worker stage observed it.
 */
export function serviceLease(deps: {
  readonly now: () => number;
  readonly reporter: ErrorReporter;
  readonly nextId: () => string;
}): ServiceLease {
  let state = currentLease;
  const observe = (signal: ServiceLeaseSignal, error?: unknown) => {
    const next = nextServiceLease(state, signal, deps.now());
    state = next.state;
    if (next.report)
      deps.reporter.capture(error, {
        requestId: deps.nextId(),
        route: ROUTE,
        errorCode: isAppError(error) ? error.code : 'INTERNAL',
      });
  };
  return {
    renewed: () => observe('renewed'),
    renewalFailed: (error) => observe('renewal-failed', error),
    lapseRefused: (error) => observe('lapse-refused', error),
  };
}
