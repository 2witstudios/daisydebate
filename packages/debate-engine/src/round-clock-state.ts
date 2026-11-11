import { createInvariantError } from '@daisy/errors';
import {
  emptyRuntimeCheckpoint,
  isRoundLifecycle,
  isRoundOver,
  roundLifecycleFault,
  runtimeCheckpointSchema,
  type HydratedSegment,
  type OverRoundStatus,
  type RoundOutcome,
  type RoundLifecycle,
  type RoundLifecycleColumns,
  type RoundRules,
  type RuntimeCheckpoint,
  type SegmentType,
} from '@daisy/protocol';
import { debateInvariantIds } from './invariant-ids';

/** Where a Round is in its life; each status holds only the instants it has. */
export type Lifecycle =
  | { readonly status: 'opening' }
  | { readonly status: 'active'; readonly startedAtMs: number }
  | {
      readonly status: 'completed';
      readonly startedAtMs: number;
      readonly completedAtMs: number;
      /** Null is a real ending that names no winner (DEC-277). */
      readonly outcome: RoundOutcome | null;
    }
  | {
      readonly status: 'abandoned';
      /** Null when the Round was abandoned in its opening. */
      readonly startedAtMs: number | null;
      readonly completedAtMs: number;
    };

/** A Round that has ended: the lifecycles that hold the instant it ended. */
export const lifecycleOver = (
  lifecycle: Lifecycle,
): lifecycle is Extract<Lifecycle, { readonly status: OverRoundStatus }> =>
  isRoundOver(lifecycle.status);

/** The instant a Round started, in the statuses that can have one. */
export const startedAtOf = (lifecycle: Lifecycle): number | null =>
  lifecycle.status === 'opening' ? null : lifecycle.startedAtMs;

/** An active Round ends with a result; nothing else can complete. */
export const completedLifecycle = (
  lifecycle: Lifecycle,
  outcome: RoundOutcome | null,
  completedAtMs: number,
): Lifecycle => {
  if (lifecycle.status !== 'active')
    throw createInvariantError(
      debateInvariantIds.lifecycleMatchesStatus,
      'Only an active round completes',
    );
  return {
    status: 'completed',
    startedAtMs: lifecycle.startedAtMs,
    completedAtMs,
    outcome,
  };
};

/** Only a running Round is abandoned; an ended one keeps its ending. */
export const abandonedLifecycle = (
  lifecycle: Lifecycle,
  completedAtMs: number,
): Lifecycle => {
  if (lifecycleOver(lifecycle))
    throw createInvariantError(
      debateInvariantIds.lifecycleMatchesStatus,
      'Only a running round is abandoned',
    );
  return {
    status: 'abandoned',
    startedAtMs: startedAtOf(lifecycle),
    completedAtMs,
  };
};
export type ClockSegment = {
  readonly sequence: number;
  readonly type: SegmentType;
  readonly key: string;
  readonly startedAtMs: number;
  readonly endedAtMs: number | null;
  readonly durationMs: number;
  readonly returnedMs: number;
};
export type ClockState = {
  readonly lifecycle: Lifecycle;
  readonly checkpoint: RuntimeCheckpoint;
  readonly rows: readonly ClockSegment[];
};
export const closedCount = (state: ClockState): number =>
  state.rows.filter((row) => row.endedAtMs !== null).length;
/** Every segment has closed: the debate is over and only its result is left. */
export const debateHasEnded = (
  state: ClockState,
  segmentCount: number,
): boolean => closedCount(state) === segmentCount;
export const countdownAnchor = (state: ClockState): number => {
  const anchor =
    state.rows.filter((row) => row.endedAtMs !== null).at(-1)?.endedAtMs ??
    startedAtOf(state.lifecycle);
  if (anchor === null)
    throw createInvariantError(
      debateInvariantIds.lifecycleMatchesStatus,
      'An active round requires a start instant',
    );
  return anchor;
};
const instantOf = (iso: string): number => {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms))
    throw createInvariantError(
      debateInvariantIds.lifecycleMatchesStatus,
      'A round lifecycle instant is not a time',
    );
  return ms;
};

/** The one rule lives beside the status vocabulary; a parsed view or a row is held to it here. */
const heldLifecycle = (round: RoundLifecycleColumns): RoundLifecycle => {
  if (!isRoundLifecycle(round))
    throw createInvariantError(
      debateInvariantIds.lifecycleMatchesStatus,
      roundLifecycleFault(round) ?? 'Round lifecycle',
    );
  return round;
};

/**
 * The stored lifecycle to the engine's, instants as milliseconds. The contract
 * holds which instants each status has; only their reading can fail after it.
 */
const lifecycleOf = (columns: RoundLifecycleColumns): Lifecycle => {
  const round = heldLifecycle(columns);
  switch (round.status) {
    case 'opening':
      return { status: round.status };
    case 'active':
      return {
        status: round.status,
        startedAtMs: instantOf(round.startedAt),
      };
    case 'completed':
      return {
        status: round.status,
        startedAtMs: instantOf(round.startedAt),
        completedAtMs: instantOf(round.completedAt),
        outcome: round.outcome,
      };
    case 'abandoned':
      return {
        status: round.status,
        startedAtMs:
          round.startedAt === null ? null : instantOf(round.startedAt),
        completedAtMs: instantOf(round.completedAt),
      };
  }
};

const assertSegmentRules = (row: ClockSegment, rules: RoundRules): void => {
  const expected = rules.segments[row.sequence];
  if (
    !expected ||
    row.key !== expected.key ||
    row.type !== expected.type ||
    row.durationMs !== expected.durationMs ||
    !Number.isSafeInteger(row.returnedMs) ||
    row.returnedMs < 0 ||
    !Number.isFinite(row.startedAtMs) ||
    (row.endedAtMs !== null &&
      (!Number.isFinite(row.endedAtMs) || row.endedAtMs < row.startedAtMs))
  )
    throw createInvariantError(
      debateInvariantIds.segmentMatchesRules,
      'A durable segment row disagrees with the resolved rules',
    );
};

export const normalizeRoundClock = (input: {
  readonly round: RoundLifecycleColumns;
  readonly segments: readonly HydratedSegment[];
  readonly checkpoint: unknown;
  readonly rules: RoundRules;
}): ClockState => {
  const lifecycle = lifecycleOf(input.round);
  const rows = input.segments
    .map((segment) => ({
      sequence: segment.sequence,
      type: segment.type,
      key: segment.rulesSegmentKey,
      startedAtMs: Date.parse(segment.startedAt),
      endedAtMs: segment.endedAt === null ? null : Date.parse(segment.endedAt),
      durationMs: segment.durationMs,
      returnedMs: segment.returnedMs,
    }))
    .sort((a, b) => a.sequence - b.sequence);
  rows.forEach((row, index) => {
    assertSegmentRules(row, input.rules);
    if (row.sequence !== index)
      throw createInvariantError(
        debateInvariantIds.segmentMatchesRules,
        'A durable segment row disagrees with the resolved rules',
      );
    const preceding = rows[index - 1];
    const earliest =
      preceding === undefined ? startedAtOf(lifecycle) : preceding.endedAtMs;
    if (
      earliest !== null &&
      earliest !== undefined &&
      row.startedAtMs < earliest
    )
      throw createInvariantError(
        debateInvariantIds.segmentMatchesRules,
        'Durable segment intervals overlap or precede Round start',
      );
    if (row.endedAtMs === null && index !== rows.length - 1)
      throw createInvariantError(
        debateInvariantIds.liveOpenSegmentCount,
        'An open segment row is followed by another row',
      );
  });
  const checkpoint = runtimeCheckpointSchema.parse(
    input.checkpoint ?? emptyRuntimeCheckpoint,
  );
  if (
    checkpoint.active_prep !== null &&
    rows.some((row) => row.endedAtMs === null)
  )
    throw createInvariantError(
      debateInvariantIds.liveOpenSegmentCount,
      'Prep cannot coexist with a live segment',
    );
  // The checkpoint contract already keeps the lead apart from prep itself.
  if (
    checkpoint.prep_ended_at !== null &&
    rows.some((row) => row.endedAtMs === null)
  )
    throw createInvariantError(
      debateInvariantIds.liveOpenSegmentCount,
      'The lead after prep is not a live segment',
    );
  if (
    checkpoint.incident.phase !== 'none' &&
    (checkpoint.incident.resume_point !== null) !==
      rows.some((row) => row.endedAtMs === null)
  )
    throw createInvariantError(
      debateInvariantIds.liveOpenSegmentCount,
      'A paused Round names a resume point exactly when a segment is open',
    );
  return { lifecycle, rows, checkpoint };
};
