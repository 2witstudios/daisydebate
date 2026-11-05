import type { UsageState } from '@daisy/protocol/billing';

type Event =
  | { readonly kind: 'dispatch' | 'expire' | 'abandon' }
  | {
      readonly kind: 'settle';
      /** Aggregate of all calls for this job: no pending/unknown call permits definite_failure. */
      readonly outcome: 'delivered' | 'unknown' | 'definite_failure';
    };
type Decision =
  | { readonly kind: 'changed' | 'unchanged'; readonly state: UsageState }
  | { readonly kind: 'refuse' };
const refused = { kind: 'refuse' } as const;
const unchanged = (state: UsageState): Decision => ({
  kind: 'unchanged',
  state,
});
const changed = (state: UsageState): Decision => ({ kind: 'changed', state });

type Reservation = {
  readonly state: UsageState;
  readonly admittedAt: string;
  readonly dispatchBefore: string;
};
type Context = { readonly now: string; readonly authorized: boolean };
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
      refundedAt: now,
    });
  return state.kind === outcome
    ? unchanged(state)
    : changed({ kind: outcome, countedAt: state.countedAt });
}
function settle(state: UsageState, outcome: Outcome, now: string): Decision {
  switch (state.kind) {
    case 'reserved':
    case 'released':
      return refused;
    case 'refunded':
      return outcome === 'definite_failure' ? unchanged(state) : refused;
    case 'delivered':
      return outcome === 'delivered' ? unchanged(state) : refused;
    case 'dispatched':
    case 'unknown':
      return settleInFlight(state, outcome, now);
  }
}
function validTime(reservation: Reservation, now: number): boolean {
  const start = Date.parse(reservation.admittedAt);
  const end = Date.parse(reservation.dispatchBefore);
  if (![now, start, end].every(Number.isFinite) || start >= end || now < start)
    return false;
  if (!('countedAt' in reservation.state)) return true;
  const counted = Date.parse(reservation.state.countedAt);
  return start <= counted && counted < end && counted <= now;
}
function dispatch(reservation: Reservation, context: Context): Decision {
  const { state } = reservation;
  if (
    !context.authorized ||
    Date.parse(context.now) >= Date.parse(reservation.dispatchBefore)
  )
    return refused;
  switch (state.kind) {
    case 'reserved':
      return changed({ kind: 'dispatched', countedAt: context.now });
    case 'dispatched':
    case 'unknown':
    case 'delivered':
      return unchanged(state);
    case 'refunded':
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
      return dispatch(reservation, context);
    case 'expire':
      return now >= Date.parse(reservation.dispatchBefore) &&
        state.kind === 'reserved'
        ? changed({ kind: 'released', releasedAt: context.now })
        : unchanged(state);
    case 'abandon':
      return abandon(state, context.now);
    case 'settle':
      return settle(state, event.outcome, context.now);
  }
}
