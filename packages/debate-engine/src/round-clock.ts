import { createInvariantError } from '@daisy/errors';
import {
  clockStopsOf,
  dueAfterStops,
  segmentDueAtMs,
  type RoundRules,
} from '@daisy/protocol';
import { resumeIfDue } from './round-incident';
import { debateInvariantIds } from './invariant-ids';
import {
  closedCount,
  countdownAnchor,
  type ClockState,
  type ClockSegment,
} from './round-clock-state';

export type ClockChange =
  | { readonly kind: 'open'; readonly row: ClockSegment }
  | {
      readonly kind: 'close';
      readonly sequence: number;
      readonly key: string;
      readonly atMs: number;
    }
  /** A platform incident silenced the open speech at this confirmed instant. */
  | { readonly kind: 'stop'; readonly sequence: number; readonly atMs: number }
  /** The speech runs again here, owed this total of returned airtime. */
  | {
      readonly kind: 'resume';
      readonly sequence: number;
      readonly atMs: number;
      readonly returnedMs: number;
      readonly holder: string | null;
    };
export type ClockTransition = {
  readonly state: ClockState;
  readonly changes: readonly ClockChange[];
};

/** Shared interval primitives for clock and command execution. Sequence is calculation identity. */
export const closeClockSegment = (
  state: ClockState,
  sequence: number,
  atMs: number,
): ClockTransition => {
  const row = state.rows.find(
    (row) => row.sequence === sequence && row.endedAtMs === null,
  );
  if (!row)
    throw createInvariantError(
      debateInvariantIds.liveOpenSegmentCount,
      'No open segment remains to close',
    );
  return {
    state: {
      ...state,
      rows: state.rows.map((row) =>
        row.sequence === sequence ? { ...row, endedAtMs: atMs } : row,
      ),
      checkpoint: { ...state.checkpoint, floor: null },
    },
    changes: [{ kind: 'close', sequence, key: row.key, atMs }],
  };
};
export const openClockSegment = (
  state: ClockState,
  rules: RoundRules,
  atMs: number,
): ClockTransition => {
  if (state.rows.some((row) => row.endedAtMs === null))
    throw createInvariantError(
      debateInvariantIds.liveOpenSegmentCount,
      'A segment opened while another is still open',
    );
  const sequence = closedCount(state);
  const expected = rules.segments[sequence];
  if (!expected)
    throw createInvariantError(
      debateInvariantIds.liveOpenSegmentCount,
      'No resolved segment remains to open',
    );
  const row: ClockSegment = {
    sequence,
    type: expected.type,
    key: expected.key,
    startedAtMs: atMs,
    endedAtMs: null,
    durationMs: expected.durationMs,
    returnedMs: 0,
  };
  return {
    state: { ...state, rows: [...state.rows, row] },
    changes: [{ kind: 'open', row }],
  };
};

const gapOpening = (
  state: ClockState,
  rules: RoundRules,
  nowMs: number,
): ClockTransition | null => {
  const active = state.checkpoint.active_prep;
  const budget = rules.inRoundPrep?.budgetMsPerSide ?? 0;
  const stops = clockStopsOf(state.checkpoint);
  const due =
    active === null
      ? dueAfterStops(countdownAnchor(state), rules.countdownMs, stops, nowMs)
      : dueAfterStops(
          Date.parse(active.started_at),
          Math.max(0, budget - state.checkpoint.prep_consumed_ms[active.side]),
          stops,
          nowMs,
        );
  if (nowMs < due) return null;
  if (active !== null)
    state = {
      ...state,
      checkpoint: {
        ...state.checkpoint,
        active_prep: null,
        prep_consumed_ms: {
          ...state.checkpoint.prep_consumed_ms,
          [active.side]: budget,
        },
      },
    };
  return openClockSegment(state, rules, due);
};

/** Time alone, without mutation, I/O, IDs or server storage. */
export const advanceRoundClock = (
  initial: ClockState,
  rules: RoundRules,
  nowMs: number,
): ClockTransition => {
  const resumed = resumeIfDue(initial, nowMs);
  let state = resumed.state;
  const changes: ClockChange[] = [...resumed.changes];
  // While a platform incident holds the clock, time alone moves nothing.
  if (
    state.lifecycle.status !== 'active' ||
    state.checkpoint.incident.phase !== 'none'
  )
    return { state, changes };
  for (;;) {
    const open = state.rows.find((row) => row.endedAtMs === null);
    let transition: ClockTransition;
    if (open) {
      const due = segmentDueAtMs(open);
      if (nowMs < due) break;
      transition = closeClockSegment(state, open.sequence, due);
    } else {
      if (closedCount(state) >= rules.segments.length) break;
      const opening = gapOpening(state, rules, nowMs);
      if (opening === null) break;
      transition = opening;
    }
    state = transition.state;
    changes.push(...transition.changes);
  }
  return { state, changes };
};
