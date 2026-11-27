import { instantMs } from '@daisy/clock/instant';
import { createInvariantError } from '@daisy/errors';
import { clockStopsOf, prepConsumedOf } from '@daisy/protocol/round';
import { dueAfterStops } from '@daisy/protocol/clock-stops';
import { segmentDueAtMs } from '@daisy/protocol/segment-end';
import { type RoundRules } from '@daisy/protocol/format';
import { resumeIfDue } from './round-incident';
import {
  closeClockSegment,
  type ClockChange,
  type ClockTransition,
} from './round-clock-transition';
import { debateInvariantIds } from './invariant-ids';
import { segmentStartsAt } from './round-start-gate';
import { duePointOfInformationChange } from './round-point-of-information';
import {
  closedCount,
  type ClockState,
  type ClockSegment,
} from './round-clock-state';

const openClockSegment = (
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
  const { prep } = state.checkpoint;
  const budget = rules.inRoundPrep?.budgetMsPerSide ?? 0;
  const stops = clockStopsOf(state.checkpoint);
  const due =
    prep.phase === 'running'
      ? dueAfterStops(
          instantMs(prep.started_at),
          Math.max(0, budget - prepConsumedOf(state.checkpoint, prep.side)),
          stops,
          nowMs,
        )
      : segmentStartsAt(state, rules.countdownMs, nowMs);
  if (nowMs < due) return null;
  // Prep ran out: it ends here, and the clock starts one microphone lead later.
  if (prep.phase === 'running')
    return {
      state: {
        ...state,
        checkpoint: {
          ...state.checkpoint,
          prep: { phase: 'lead', ended_at: new Date(due).toISOString() },
          prep_consumed_ms: {
            ...state.checkpoint.prep_consumed_ms,
            [prep.side]: budget,
          },
        },
      },
      changes: [],
    };
  // The gate and prep's lead are spent: the clock now starts, and nothing below reads them.
  return openClockSegment(
    {
      ...state,
      checkpoint: {
        ...state.checkpoint,
        start_gate: null,
        prep: { phase: 'idle' },
      },
    },
    rules,
    due,
  );
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
      // A point of information due inside the speech moves first, at its own instant.
      const point = duePointOfInformationChange(state, rules, open, nowMs);
      const due = segmentDueAtMs(open);
      if (point !== null) transition = point.transition;
      else if (nowMs < due) break;
      else transition = closeClockSegment(state, open.sequence, due);
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
