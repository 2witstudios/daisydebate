import type {
  UsageState,
  UsageContext as Context,
  UsageEvent as Event,
  UsageReservation as Reservation,
  UsageTransition as Decision,
  PlatformUsageCredit,
} from './billing';

const refused = { kind: 'refuse' } as const;
const unchanged = (state: UsageState): Decision => ({
  kind: 'unchanged',
  state,
});
const changed = (state: UsageState): Decision => ({ kind: 'changed', state });

type Outcome = Extract<Event, { kind: 'settle' }>['outcome'];

function settleInFlight(
  state: Extract<UsageState, { kind: 'dispatched' | 'unknown' | 'delivered' }>,
  outcome: Outcome,
  now: string,
): Decision {
  if (outcome === 'definite_failure')
    return changed({
      kind: 'refunded',
      countedAt: state.countedAt,
      countBasis: state.countBasis,
      refundedAt: now,
    });
  return state.kind === outcome
    ? unchanged(state)
    : changed({
        kind: outcome,
        countedAt: state.countedAt,
        countBasis: state.countBasis,
      });
}
function settle(state: UsageState, outcome: Outcome, now: string): Decision {
  switch (state.kind) {
    case 'reserved':
    case 'released':
      return refused;
    case 'credited':
      return settleCredited(state, outcome);
    case 'refunded':
    case 'definite_failure':
      return outcome === 'definite_failure' ? unchanged(state) : refused;
    case 'delivered':
      return outcome === 'delivered' ? unchanged(state) : refused;
    case 'dispatched':
    case 'unknown':
      return settleInFlight(state, outcome, now);
  }
}
function settleCredited(
  state: Extract<UsageState, { kind: 'credited' }>,
  outcome: Outcome,
): Decision {
  if (state.providerOutcome === outcome) return unchanged(state);
  if (
    state.providerOutcome === 'delivered' ||
    state.providerOutcome === 'definite_failure'
  )
    return refused;
  return changed({ ...state, providerOutcome: outcome });
}

/** Accounting relief is separate from whether a provider served or charged. */
function platformCredit(
  reservation: Reservation,
  provenance: PlatformUsageCredit,
  now: string,
): Decision {
  const { state } = reservation;
  if (reservation.kind !== 'ai_round' || !('countedAt' in state))
    return refused;
  if (state.kind === 'refunded' || state.kind === 'credited')
    return unchanged(state);
  return changed({
    kind: 'credited',
    countedAt: state.countedAt,
    countBasis: state.countBasis,
    creditedAt: now,
    provenance,
    providerOutcome: state.kind,
  });
}

function terminalAt(state: UsageState): string | null {
  switch (state.kind) {
    case 'released':
      return state.releasedAt;
    case 'refunded':
      return state.refundedAt;
    case 'credited':
      return state.creditedAt;
    default:
      return null;
  }
}
function validHistory(state: UsageState, start: number, now: number): boolean {
  const counted = 'countedAt' in state ? Date.parse(state.countedAt) : start;
  if (!(start <= counted && counted <= now)) return false;
  const terminal = terminalAt(state);
  return (
    terminal === null ||
    (counted <= Date.parse(terminal) && Date.parse(terminal) <= now)
  );
}
function validTime(reservation: Reservation, now: number): boolean {
  const start = Date.parse(reservation.admittedAt);
  return (
    [now, start].every(Number.isFinite) &&
    now >= start &&
    validHistory(reservation.state, start, now)
  );
}
function mayDispatch(before: string, context: Context): boolean {
  const cutoff = Date.parse(before);
  return (
    context.authorized &&
    Number.isFinite(cutoff) &&
    Date.parse(context.now) < cutoff
  );
}
function dispatch(
  reservation: Reservation,
  before: string,
  context: Context,
): Decision {
  const { state } = reservation;
  if (!mayDispatch(before, context)) return refused;
  switch (state.kind) {
    case 'reserved':
      return changed({
        kind: 'dispatched',
        countedAt: context.now,
        countBasis: 'dispatch_record',
      });
    case 'dispatched':
    case 'unknown':
    case 'delivered':
      return unchanged(state);
    case 'credited':
    case 'refunded':
    case 'definite_failure':
    case 'released':
      return refused;
  }
}
function abandon(state: UsageState, now: string): Decision {
  if (state.kind === 'released') return unchanged(state);
  return state.kind === 'reserved'
    ? changed({ kind: 'released', releasedAt: now })
    : refused;
}
/**
 * Dispatch is durably recorded before provider I/O, so only `reserved` proves
 * non-dispatch. Expiry never makes an uncertain call free. Late accounting
 * observations are retained; content publication checks privacy separately.
 */
export function advanceUsage(
  reservation: Reservation,
  event: Event,
  context: Context,
): Decision {
  const { state } = reservation;
  const now = Date.parse(context.now);
  if (!validTime(reservation, now)) return refused;
  switch (event.kind) {
    case 'dispatch':
      return dispatch(reservation, event.before, context);
    case 'expire':
      if (!Number.isFinite(Date.parse(event.before))) return refused;
      return now >= Date.parse(event.before) && state.kind === 'reserved'
        ? changed({ kind: 'released', releasedAt: context.now })
        : unchanged(state);
    case 'abandon':
      return abandon(state, context.now);
    case 'settle':
      return settle(state, event.outcome, context.now);
    case 'platform_credit':
      return platformCredit(reservation, event.provenance, context.now);
  }
}
