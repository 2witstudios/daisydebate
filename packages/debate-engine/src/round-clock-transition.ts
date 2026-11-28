import { createInvariantError } from '@daisy/errors';
import type { PlatformIncidentCause } from '@daisy/protocol/round';
import { debateInvariantIds } from './invariant-ids';
import type { ClockSegment, ClockState } from './round-clock-state';

type ClockIncidentChange =
  | {
      readonly kind: 'opened';
      readonly since: string;
      readonly cause: PlatformIncidentCause;
      readonly resumePoint: string | null;
    }
  | {
      readonly kind: 'resumed';
      readonly at: string;
      readonly returnedMs: number;
    }
  | { readonly kind: 'ended'; readonly at: string };

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
    }
  /**
   * Who speaks in the open segment changed at this instant: a point of
   * information was accepted or gave the speech back, or a seat left. The
   * segment and its clock run on.
   */
  | {
      readonly kind: 'speakers';
      readonly sequence: number;
      readonly atMs: number;
      /** The seat giving an accepted point of information, if any. */
      readonly poiHolder: string | null;
      /** The seats that have left from this instant, when a leave changed them. */
      readonly absent?: readonly string[];
    }
  /** What this transition did to a platform incident, for its durable row. */
  | { readonly kind: 'incident'; readonly change: ClockIncidentChange };
export type ClockTransition = {
  readonly state: ClockState;
  readonly changes: readonly ClockChange[];
};

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * A segment's close, the one shared primitive for clock and commands; sequence
 * is calculation identity. Closing ends the speech's point of information, and
 * starts at this exact instant any prep the next segment's side called while
 * it ran (INTX-2).
 */
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
  const { prep } = state.checkpoint;
  return {
    state: {
      ...state,
      rows: state.rows.map((row) =>
        row.sequence === sequence ? { ...row, endedAtMs: atMs } : row,
      ),
      checkpoint: {
        ...state.checkpoint,
        point_of_information: { phase: 'none' },
        prep:
          prep.phase === 'called'
            ? { phase: 'running', side: prep.side, started_at: iso(atMs) }
            : prep,
      },
    },
    changes: [{ kind: 'close', sequence, key: row.key, atMs }],
  };
};
