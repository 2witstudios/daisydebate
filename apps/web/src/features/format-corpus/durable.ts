import { createRoundRuntime } from '@daisy/debate-engine';
import {
  emptyRuntimeCheckpoint,
  type HydratedSegment,
  type RoundLifecycle,
  type RoundProjection,
  type RoundRules,
  type RoundStage,
  type RuntimeCheckpoint,
} from '@daisy/protocol';
import type { CorpusSeat } from './corpus-seats';

/** What the persistence adapter holds after applying every projection so far. */
export type Durable = {
  readonly round: RoundLifecycle & { readonly currentStage: RoundStage | null };
  readonly segments: readonly HydratedSegment[];
  readonly checkpoint: RuntimeCheckpoint;
  readonly finalSegmentEndedAt: string | null;
};

/** A Round in its opening, before any write. */
export const opening: Durable = {
  round: {
    status: 'opening',
    startedAt: null,
    completedAt: null,
    outcome: null,
    currentStage: null,
  },
  segments: [],
  checkpoint: emptyRuntimeCheckpoint,
  finalSegmentEndedAt: null,
};

/** The adapter's writes for one projection, applied to what it held. */
export const persisted = (
  held: Durable,
  projection: RoundProjection,
): Durable => {
  const inserted = projection.segmentInserts.map((row) => ({
    ...row,
    endedAt: null,
    returnedMs: 0,
  }));
  const segments = [...held.segments, ...inserted].map((row) => ({
    ...row,
    endedAt:
      projection.segmentCloses.find((close) => close.id === row.id)?.endedAt ??
      row.endedAt,
    returnedMs:
      projection.segmentReturns?.find((back) => back.id === row.id)
        ?.returnedMs ?? row.returnedMs,
  }));
  const round = projection.round;
  return {
    round: round ?? held.round,
    checkpoint: round?.checkpoint ?? held.checkpoint,
    segments,
    finalSegmentEndedAt:
      projection.finalSegmentEndedAt ?? held.finalSegmentEndedAt,
  };
};

/** A runtime hydrated from durable rows, as every server path builds one; segment ids continue the rows'. */
export const hydrate = (
  rules: RoundRules,
  seats: readonly CorpusSeat[],
  durable: Durable,
) => {
  let next = durable.segments.length;
  return createRoundRuntime({
    round: { id: 'round-1', ...durable.round },
    rules,
    participants: seats,
    checkpoint: durable.checkpoint,
    segments: durable.segments,
    nextSegmentId: () => {
      next += 1;
      return `segment-${next}`;
    },
  });
};
