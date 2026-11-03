import type {
  PlatformIncidentCause,
  RoundIncident,
  RoundRules,
} from '@daisy/protocol';
import {
  abandonedLifecycle,
  debateHasEnded,
  type ClockState,
} from './round-clock-state';
import { closeClockSegment, type ClockTransition } from './round-clock';

/**
 * A platform incident (ADR 0110): the server saw the media platform fail and
 * holds the Round\x27s clock. These are the only ways that hold changes, and no
 * player input reaches any of them. Every event is defined from every phase;
 * one that means nothing there leaves the state as it was.
 */
export type IncidentEvent =
  | {
      readonly kind: 'pause';
      readonly atMs: number;
      readonly cause: PlatformIncidentCause;
      /** The end of the holder\x27s last confirmed audio, if any was confirmed. */
      readonly confirmedUntilMs: number | null;
    }
  | {
      readonly kind: 'begin_resume';
      readonly atMs: number;
      readonly countdownMs: number;
    }
  | { readonly kind: 'end'; readonly atMs: number };

const iso = (ms: number) => new Date(ms).toISOString();
const openRow = (state: ClockState) =>
  state.rows.find((row) => row.endedAtMs === null);
const stay = (state: ClockState): ClockTransition => ({ state, changes: [] });
const withIncident = (
  state: ClockState,
  incident: RoundIncident,
): ClockState => ({ ...state, checkpoint: { ...state.checkpoint, incident } });

/** A speech resumes from confirmed audio, never before it started or after the pause. */
const resumePointOf = (
  state: ClockState,
  event: Extract<IncidentEvent, { kind: 'pause' }>,
): number | null => {
  const open = openRow(state);
  if (open === undefined) return null;
  return Math.min(
    event.atMs,
    Math.max(event.confirmedUntilMs ?? open.startedAtMs, open.startedAtMs),
  );
};

const pause = (
  state: ClockState,
  rules: RoundRules,
  event: Extract<IncidentEvent, { kind: 'pause' }>,
): ClockTransition => {
  const { status } = state.lifecycle;
  if (
    (status !== 'opening' && status !== 'active') ||
    debateHasEnded(state, rules.segments.length)
  )
    return stay(state);
  const pointMs = resumePointOf(state, event);
  const open = openRow(state);
  return {
    state: withIncident(state, {
      phase: 'paused',
      since: iso(event.atMs),
      cause: event.cause,
      resume_point: pointMs === null ? null : iso(pointMs),
    }),
    changes:
      open !== undefined && pointMs !== null
        ? [{ kind: 'stop', sequence: open.sequence, atMs: pointMs }]
        : [],
  };
};

const beginResume = (
  state: ClockState,
  event: Extract<IncidentEvent, { kind: 'begin_resume' }>,
): ClockTransition => {
  const { incident } = state.checkpoint;
  if (incident.phase !== 'paused') return stay(state);
  return stay(
    withIncident(state, {
      ...incident,
      phase: 'resuming',
      until: iso(event.atMs + event.countdownMs),
    }),
  );
};

/** A second failure during the countdown holds the same incident again. */
const pauseAgain = (state: ClockState): ClockTransition => {
  const { incident } = state.checkpoint;
  if (incident.phase !== 'resuming') return stay(state);
  const { until: _until, ...held } = incident;
  return stay(withIncident(state, { ...held, phase: 'paused' }));
};

const end = (
  state: ClockState,
  event: Extract<IncidentEvent, { kind: 'end' }>,
): ClockTransition => {
  const { incident } = state.checkpoint;
  if (incident.phase === 'none') return stay(state);
  const open = openRow(state);
  const closed =
    open !== undefined && incident.resume_point !== null
      ? closeClockSegment(
          state,
          open.sequence,
          Date.parse(incident.resume_point),
        )
      : stay(state);
  return {
    state: {
      lifecycle: abandonedLifecycle(state.lifecycle, event.atMs),
      rows: closed.state.rows,
      checkpoint: {
        ...closed.state.checkpoint,
        active_prep: null,
        incident: { phase: 'none' },
        clock_stops: [
          ...state.checkpoint.clock_stops,
          { from: incident.since, to: iso(event.atMs) },
        ],
      },
    },
    changes: closed.changes,
  };
};

const transitions: Readonly<
  Record<
    RoundIncident['phase'],
    Readonly<{
      [K in IncidentEvent['kind']]: (
        state: ClockState,
        rules: RoundRules,
        event: Extract<IncidentEvent, { kind: K }>,
      ) => ClockTransition;
    }>
  >
> = {
  none: { pause, begin_resume: stay, end: stay },
  paused: {
    pause: stay,
    begin_resume: (state, _rules, event) => beginResume(state, event),
    end: (state, _rules, event) => end(state, event),
  },
  resuming: {
    pause: pauseAgain,
    begin_resume: stay,
    end: (state, _rules, event) => end(state, event),
  },
};

/** The one way a platform incident changes a Round; pure and total. */
export const incidentTransition = (
  state: ClockState,
  rules: RoundRules,
  event: IncidentEvent,
): ClockTransition => {
  const row = transitions[state.checkpoint.incident.phase];
  switch (event.kind) {
    case 'pause':
      return row.pause(state, rules, event);
    case 'begin_resume':
      return row.begin_resume(state, rules, event);
    case 'end':
      return row.end(state, rules, event);
  }
};

/**
 * The countdown has ended: the speech gets back the time from its resume point
 * to this instant, and the clock runs. Applied by the clock itself at the
 * instant it was due, so a late tick cannot shorten or lengthen anything.
 */
export const resumeIfDue = (
  state: ClockState,
  nowMs: number,
): ClockTransition => {
  const { incident, clock_stops: stops } = state.checkpoint;
  if (incident.phase !== 'resuming' || nowMs < Date.parse(incident.until))
    return stay(state);
  const untilMs = Date.parse(incident.until);
  const open = openRow(state);
  const returned =
    open !== undefined && incident.resume_point !== null
      ? open.returnedMs + (untilMs - Date.parse(incident.resume_point))
      : null;
  return {
    state: {
      ...state,
      rows: state.rows.map((row) =>
        row === open && returned !== null
          ? { ...row, returnedMs: returned }
          : row,
      ),
      checkpoint: {
        ...state.checkpoint,
        incident: { phase: 'none' },
        clock_stops: [...stops, { from: incident.since, to: incident.until }],
      },
    },
    changes:
      open !== undefined && returned !== null
        ? [
            {
              kind: 'resume',
              sequence: open.sequence,
              atMs: untilMs,
              returnedMs: returned,
              holder: state.checkpoint.floor?.holder_participant_id ?? null,
            },
          ]
        : [],
  };
};
