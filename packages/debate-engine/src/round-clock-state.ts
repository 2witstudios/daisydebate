import { createInvariantError } from '@daisy/errors';
import {
  emptyRuntimeCheckpoint,
  runtimeCheckpointSchema,
  type HydratedRound,
  type HydratedSegment,
  type RoundOutcome,
  type RoundRules,
  type RoundStatus,
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
  if (lifecycle.status === 'completed' || lifecycle.status === 'abandoned')
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
const instant = (iso: string | null): number | null =>
  iso === null ? null : Date.parse(iso);

const invalidLifecycle = (status: RoundStatus): never => {
  throw createInvariantError(
    debateInvariantIds.lifecycleMatchesStatus,
    status === 'active'
      ? 'An active round requires a start instant'
      : `A ${status} round's durable lifecycle is not one its status can hold`,
  );
};

const known = (ms: number | null): ms is number =>
  ms !== null && Number.isFinite(ms);

/** Durable columns to the one lifecycle they mean; any other combination is corruption. */
const lifecycleOf = (
  round: Pick<
    HydratedRound,
    'status' | 'startedAt' | 'completedAt' | 'outcome'
  >,
): Lifecycle => {
  const { status, outcome } = round;
  const startedAtMs = instant(round.startedAt);
  const completedAtMs = instant(round.completedAt);
  switch (status) {
    case 'opening':
      return startedAtMs === null && completedAtMs === null && outcome === null
        ? { status }
        : invalidLifecycle(status);
    case 'active':
      return known(startedAtMs) && completedAtMs === null && outcome === null
        ? { status, startedAtMs }
        : invalidLifecycle(status);
    case 'completed':
      return known(startedAtMs) && known(completedAtMs)
        ? { status, startedAtMs, completedAtMs, outcome }
        : invalidLifecycle(status);
    case 'abandoned':
      return (startedAtMs === null || known(startedAtMs)) &&
        known(completedAtMs) &&
        outcome === null
        ? { status, startedAtMs, completedAtMs }
        : invalidLifecycle(status);
  }
};

const assertSegmentRules = (row: ClockSegment, rules: RoundRules): void => {
  const expected = rules.segments[row.sequence];
  if (
    !expected ||
    row.key !== expected.key ||
    row.type !== expected.type ||
    row.durationMs !== expected.durationMs ||
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
  readonly round: Pick<
    HydratedRound,
    'status' | 'startedAt' | 'completedAt' | 'outcome'
  >;
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
  return { lifecycle, rows, checkpoint };
};
