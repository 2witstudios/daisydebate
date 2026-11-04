import type { RoundStartGate } from '@daisy/protocol';
import { clockStopsOf, dueAfterStops } from '@daisy/protocol';
import {
  closedCount,
  countdownAnchor,
  type ClockState,
} from './round-clock-state';
import type { ClockTransition } from './round-clock-transition';

export type StartGateEvent =
  /** The microphone is opening: these speakers are not yet reported on this room. */
  | {
      readonly kind: 'await';
      readonly atMs: number;
      readonly seats: readonly string[];
      readonly boundMs: number;
    }
  /** Capture reports reading this seat's track on this room. */
  | { readonly kind: 'heard'; readonly atMs: number; readonly seat: string };

const iso = (ms: number) => new Date(ms).toISOString();
const stay = (state: ClockState): ClockTransition => ({ state, changes: [] });
const withGate = (state: ClockState, gate: RoundStartGate): ClockTransition =>
  stay({ ...state, checkpoint: { ...state.checkpoint, start_gate: gate } });

/** When the countdown to the next segment ends, with no gate. */
export const countdownDue = (
  state: ClockState,
  countdownMs: number,
  nowMs: number,
) =>
  dueAfterStops(
    countdownAnchor(state),
    countdownMs,
    clockStopsOf(state.checkpoint),
    nowMs,
  );

/** When the next segment's clock starts: one instant, for every reader of the clock. */
export const segmentStartsAt = (
  state: ClockState,
  countdownMs: number,
  nowMs: number,
): number => {
  const due = countdownDue(state, countdownMs, nowMs);
  const gate = state.checkpoint.start_gate;
  if (gate === null || gate.sequence !== closedCount(state)) return due;
  return Math.max(
    due,
    Date.parse(gate.phase === 'awaiting' ? gate.until : gate.at),
  );
};

const awaitCapture = (
  state: ClockState,
  countdownMs: number,
  event: Extract<StartGateEvent, { kind: 'await' }>,
): ClockTransition => {
  const sequence = closedCount(state);
  const open = state.rows.some((row) => row.endedAtMs === null);
  const gate = state.checkpoint.start_gate;
  if (
    state.lifecycle.status !== 'active' ||
    open ||
    event.seats.length === 0 ||
    state.checkpoint.incident.phase !== 'none' ||
    state.checkpoint.active_prep !== null ||
    gate?.sequence === sequence
  )
    return stay(state);
  const due = countdownDue(state, countdownMs, event.atMs);
  return withGate(state, {
    phase: 'awaiting',
    sequence,
    seats: event.seats,
    until: iso(due + event.boundMs),
  });
};

const heard = (
  state: ClockState,
  event: Extract<StartGateEvent, { kind: 'heard' }>,
): ClockTransition => {
  const gate = state.checkpoint.start_gate;
  if (gate?.phase !== 'awaiting' || !gate.seats.includes(event.seat))
    return stay(state);
  const seats = gate.seats.filter((seat) => seat !== event.seat);
  return withGate(
    state,
    seats.length > 0
      ? { ...gate, seats }
      : { phase: 'ready', sequence: gate.sequence, at: iso(event.atMs) },
  );
};

/** The one way a start gate changes; pure and total. */
export const startGateTransition = (
  state: ClockState,
  countdownMs: number,
  event: StartGateEvent,
): ClockTransition =>
  event.kind === 'await'
    ? awaitCapture(state, countdownMs, event)
    : heard(state, event);
