import { createInvariantError } from '@daisy/errors';
import {
  emptyRuntimeCheckpoint,
  runtimeCheckpointSchema,
  type HydratedRound,
  type HydratedSegment,
  type RatedOutcome,
  type RoundRules,
  type RoundStatus,
  type RuntimeCheckpoint,
  type SegmentType,
} from '@daisy/protocol';
import { debateInvariantIds } from './invariant-ids';

export type Lifecycle = {
  readonly status: RoundStatus;
  readonly startedAtMs: number | null;
  readonly completedAtMs: number | null;
  readonly outcome: RatedOutcome | null;
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
export const countdownAnchor = (state: ClockState): number => {
  const anchor =
    state.rows.filter((row) => row.endedAtMs !== null).at(-1)?.endedAtMs ??
    state.lifecycle.startedAtMs;
  if (anchor === null)
    throw createInvariantError(
      debateInvariantIds.segmentMatchesRules,
      'An active round requires a start instant',
    );
  return anchor;
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
  const lifecycle: Lifecycle = {
    status: input.round.status,
    startedAtMs:
      input.round.startedAt === null ? null : Date.parse(input.round.startedAt),
    completedAtMs:
      input.round.completedAt === null
        ? null
        : Date.parse(input.round.completedAt),
    outcome: input.round.outcome,
  };
  if (
    lifecycle.status === 'active' &&
    (lifecycle.startedAtMs === null || !Number.isFinite(lifecycle.startedAtMs))
  )
    throw createInvariantError(
      debateInvariantIds.segmentMatchesRules,
      'An active round requires a start instant',
    );
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
