import { SERVICE_LEASE_WINDOW_MS } from '@daisy/db/service-lease-lapse';
import { createAppError } from '@daisy/errors';
import type { ErrorReporter } from '@daisy/observability';

/**
 * How long this instance's lease must keep lapsing before it is reported:
 * past the 3 s lease window and any one transaction's budget, so a lapse the
 * next renewal clears never reaches the error tracker (DAISY-WEB-9).
 */
const PERSIST_MS = 10_000;
/**
 * How long the lease must go without a lapse before a lapse is over. Twice
 * the lease window, so a lease that flaps (current for a renewal, lapsed
 * before the next) is one lapse, while blips further apart are separate.
 */
const RECOVERED_MS = 2 * SERVICE_LEASE_WINDOW_MS;
/** How often a lapse that lasts is reported again. */
const REPEAT_MS = 5 * 60_000;
/** One error-tracker route for the one instance condition, whatever saw it. */
const ROUTE = 'web.service-lease.lapsed';

/** One lapse: from its first lapsed observation to its latest. */
type Lapse = {
  readonly sinceMs: number;
  readonly lastMs: number;
  /** Monotonic ms of the latest report of this lapse, if any. */
  readonly reportedAtMs: number | null;
};

/**
 * What this web instance knows about its own service lease. Its renewals are
 * the truth: one that succeeds was stamped no earlier than its call, so the
 * lease is known current until that call plus the lease window. Past that,
 * or whenever a worker is refused for a lapsed lease, it is lapsed.
 */
export type ServiceLeaseState = {
  /** Monotonic ms until which the lease is known current. */
  readonly currentUntilMs: number;
  readonly lapse: Lapse | null;
};

export type ServiceLeaseSignal =
  /** A renewal succeeded `tookMs` after it was called. */
  | { readonly kind: 'renewed'; readonly tookMs: number }
  | { readonly kind: 'renewal-failed' }
  | { readonly kind: 'lapse-refused' };

export const unknownLease: ServiceLeaseState = {
  currentUntilMs: Number.NEGATIVE_INFINITY,
  lapse: null,
};

/** The state after one signal at `nowMs`, and whether to report. Pure and total. */
export function nextServiceLease(
  state: ServiceLeaseState,
  signal: ServiceLeaseSignal,
  nowMs: number,
): { readonly state: ServiceLeaseState; readonly report: boolean } {
  const currentUntilMs =
    signal.kind === 'renewed'
      ? Math.max(
          state.currentUntilMs,
          nowMs - signal.tookMs + SERVICE_LEASE_WINDOW_MS,
        )
      : state.currentUntilMs;
  const lapsed = signal.kind === 'lapse-refused' || nowMs >= currentUntilMs;
  const ongoing =
    state.lapse !== null && nowMs - state.lapse.lastMs <= RECOVERED_MS
      ? state.lapse
      : null;
  if (!lapsed)
    return { state: { currentUntilMs, lapse: ongoing }, report: false };
  const lapse: Lapse = ongoing
    ? { ...ongoing, lastMs: nowMs }
    : { sinceMs: nowMs, lastMs: nowMs, reportedAtMs: null };
  const report =
    nowMs - lapse.sinceMs >= PERSIST_MS &&
    (lapse.reportedAtMs === null || nowMs - lapse.reportedAtMs >= REPEAT_MS);
  return {
    state: {
      currentUntilMs,
      lapse: report ? { ...lapse, reportedAtMs: nowMs } : lapse,
    },
    report,
  };
}

/** This instance's lease health, fed by its renewals and its workers. */
export type ServiceLease = {
  /** A renewal settled `tookMs` after it was called. */
  readonly renewed: (tookMs: number) => void;
  readonly renewalFailed: (error: unknown) => void;
  readonly lapseRefused: (error: unknown) => void;
};

/**
 * The one lease state of a process, timed by an injected monotonic clock.
 * A report is one fixed error under one fixed route, whichever renewal or
 * worker stage observed it, with the triggering failure as its cause. It goes
 * to the app's own reporter, since a lapse is the instance's, not a worker's.
 * A report that fails to send is not counted, so the next lapse retries it.
 */
export function serviceLease(deps: {
  readonly now: () => number;
  readonly reporter: ErrorReporter;
  readonly nextId: () => string;
}): ServiceLease {
  let state = unknownLease;
  const observe = (signal: ServiceLeaseSignal, cause?: unknown) => {
    const next = nextServiceLease(state, signal, deps.now());
    const unsent = next.state.lapse && {
      ...next.state,
      lapse: {
        ...next.state.lapse,
        // The same lapse keeps its earlier report time; a new one has none.
        reportedAtMs:
          state.lapse?.sinceMs === next.state.lapse.sinceMs
            ? state.lapse.reportedAtMs
            : null,
      },
    };
    state = next.state;
    if (!next.report) return;
    try {
      deps.reporter.capture(
        createAppError('INFRASTRUCTURE', 'Web service lease lapsing', cause),
        { requestId: deps.nextId(), route: ROUTE, errorCode: 'INFRASTRUCTURE' },
      );
    } catch {
      if (unsent) state = unsent;
    }
  };
  return {
    renewed: (tookMs) => observe({ kind: 'renewed', tookMs }),
    renewalFailed: (error) => observe({ kind: 'renewal-failed' }, error),
    lapseRefused: (error) => observe({ kind: 'lapse-refused' }, error),
  };
}
