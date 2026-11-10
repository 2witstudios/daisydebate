import { isAppError } from '@daisy/errors';

/**
 * How long a web instance's lease lapses must keep arriving before they
 * count as persistent: past the 3 s lease window and any one transaction's
 * budget, so a blip that the next renewal clears never reports.
 */
const PERSIST_MS = 10_000;
/**
 * A lapse this long after the last one is a new lapse: the earlier one
 * cleared, so its streak ends and a later persistent lapse reports again.
 */
const QUIET_MS = 30_000;

/**
 * Whether this web instance's own service lease is lapsing (DAISY-WEB-9). A
 * lapse belongs to the whole instance, never to one worker stage, so every
 * worker on the process feeds the same state.
 */
export type LeaseLapseState =
  | { readonly kind: 'clear' }
  | {
      readonly kind: 'lapsing';
      /** Monotonic ms of the streak's first lapse. */
      readonly sinceMs: number;
      /** Monotonic ms of its latest lapse. */
      readonly lastMs: number;
      readonly reported: boolean;
    };

/** `persisted` exactly once per streak, on the lapse that crosses the bound. */
export type LeaseLapseVerdict = 'transient' | 'persisted';

export const clearLease: LeaseLapseState = { kind: 'clear' };

/** One more lapse observed at `nowMs`. Pure and total. */
export function observeLeaseLapse(
  state: LeaseLapseState,
  nowMs: number,
): { readonly state: LeaseLapseState; readonly verdict: LeaseLapseVerdict } {
  if (state.kind === 'clear' || nowMs - state.lastMs > QUIET_MS)
    return {
      state: {
        kind: 'lapsing',
        sinceMs: nowMs,
        lastMs: nowMs,
        reported: false,
      },
      verdict: 'transient',
    };
  const persisted = !state.reported && nowMs - state.sinceMs >= PERSIST_MS;
  return {
    state: {
      ...state,
      lastMs: nowMs,
      reported: state.reported || persisted,
    },
    verdict: persisted ? 'persisted' : 'transient',
  };
}

/** The refusal `requireCurrentWeb` raises when the lease is not current. */
export const isLeaseLapse = (error: unknown): boolean =>
  isAppError(error) && error.reason === 'service-lease-lapsed';

export type LeaseLapses = { readonly observe: () => LeaseLapseVerdict };

/** The process's one lapse state, timed by an injected monotonic clock. */
export function leaseLapses(now: () => number): LeaseLapses {
  let state = clearLease;
  return {
    observe() {
      const next = observeLeaseLapse(state, now());
      state = next.state;
      return next.verdict;
    },
  };
}
