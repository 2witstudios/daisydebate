import { createInvariantError } from '@daisy/errors';
import type { PlatformIncidentCause } from '@daisy/protocol';
import { debateInvariantIds } from './invariant-ids';
import type { ClockSegment, ClockState } from './round-clock-state';

export type ClockIncidentChange =
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
      readonly holder: string | null;
    }
  /** What this transition did to a platform incident, for its durable row. */
  | { readonly kind: 'incident'; readonly change: ClockIncidentChange };
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
