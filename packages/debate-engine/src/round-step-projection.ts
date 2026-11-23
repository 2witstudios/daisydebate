import { instantMs } from '@daisy/clock';
import { createInvariantError } from '@daisy/errors';
import type { RoundRules } from '@daisy/protocol/format';
import {
  runtimeCheckpointSchema,
  type RuntimeCheckpoint,
} from '@daisy/protocol/round';
import type {
  RoundIncidentChange,
  RoundProjection,
  SegmentClose,
  SegmentInsert,
} from '@daisy/protocol/runtime';
import { debateInvariantIds } from './invariant-ids';
import { roundHoldsMembers } from './room-membership';
import type { ClockState } from './round-clock-state';
import { lifecycleColumnsOf, stageOf } from './round-position-projection';
import { speakingChangesOf } from './round-speaking';
import type { RoundStep } from './round-step';

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * The checkpoint in its one stored form: instants in canonical ISO, and the
 * absent seats omitted until one leaves, so no other checkpoint changes shape.
 */
export const storedCheckpointOf = (
  checkpoint: RuntimeCheckpoint,
): RuntimeCheckpoint => {
  const { active_prep: prep, floor } = checkpoint;
  const absent = checkpoint.absent_participant_ids ?? [];
  return {
    version: 1,
    prep_consumed_ms: { ...checkpoint.prep_consumed_ms },
    active_prep:
      prep === null
        ? null
        : { side: prep.side, started_at: iso(instantMs(prep.started_at)) },
    floor:
      floor === null
        ? null
        : {
            holder_participant_id: floor.holder_participant_id,
            granted_at: iso(instantMs(floor.granted_at)),
          },
    incident: checkpoint.incident,
    prep_ended_at: checkpoint.prep_ended_at,
    start_gate: checkpoint.start_gate,
    clock_stops: checkpoint.clock_stops,
    ...(absent.length > 0 ? { absent_participant_ids: [...absent] } : {}),
  };
};

/** The clock with its checkpoint validated against the contract, as every reader takes it. */
export const validClockOf = (clock: ClockState): ClockState => ({
  ...clock,
  checkpoint: runtimeCheckpointSchema.parse(
    storedCheckpointOf(clock.checkpoint),
  ),
});

/**
 * A step as the durable writes that materialize it. This is the one place
 * ids exist: each segment row the step opened, and each incident it opened,
 * takes the next id from `mint`, in that order, and the returned map knows
 * every segment's id for the next step.
 */
export const projectRoundStep = (input: {
  readonly step: RoundStep;
  readonly rules: RoundRules;
  readonly segmentIds: ReadonlyMap<number, string>;
  readonly mint: () => string;
}): {
  readonly projection: RoundProjection;
  readonly segmentIds: ReadonlyMap<number, string>;
} => {
  const { step, rules } = input;
  const { changes } = step;
  const ids = new Map(input.segmentIds);
  const segmentIdOf = (sequence: number): string => {
    const id = ids.get(sequence);
    if (id === undefined)
      throw createInvariantError(
        debateInvariantIds.segmentMatchesRules,
        'A clock change names a segment that was never opened',
      );
    return id;
  };
  const segmentInserts: SegmentInsert[] = changes.flatMap((change) => {
    if (change.kind !== 'open') return [];
    const id = input.mint();
    ids.set(change.row.sequence, id);
    return [
      {
        id,
        sequence: change.row.sequence,
        type: change.row.type,
        rulesSegmentKey: change.row.key,
        startedAt: iso(change.row.startedAtMs),
        durationMs: change.row.durationMs,
      },
    ];
  });
  const segmentCloses: SegmentClose[] = changes.flatMap((change) =>
    change.kind === 'close'
      ? [{ id: segmentIdOf(change.sequence), endedAt: iso(change.atMs) }]
      : [],
  );
  const segmentReturns = changes.flatMap((change) =>
    change.kind === 'resume'
      ? [{ id: segmentIdOf(change.sequence), returnedMs: change.returnedMs }]
      : [],
  );
  const incidentChanges = changes.flatMap((change): RoundIncidentChange[] =>
    change.kind !== 'incident'
      ? []
      : change.change.kind === 'opened'
        ? [{ ...change.change, id: input.mint() }]
        : [change.change],
  );
  const finalClose = changes.find(
    (change) =>
      change.kind === 'close' && change.sequence === rules.segments.length - 1,
  );
  const finalEndedAt =
    step.finalPlayedEnd ??
    (finalClose?.kind === 'close' ? iso(finalClose.atMs) : undefined);
  const clock = validClockOf(step.state.clock);
  // This revision stops the Round holding its Room's members (ADR 0070).
  const releasesRoomMembers = !roundHoldsMembers({
    status: clock.lifecycle.status,
    debateEnded: finalEndedAt !== undefined,
  });
  return {
    segmentIds: ids,
    projection: {
      ...(finalEndedAt !== undefined
        ? { finalSegmentEndedAt: finalEndedAt }
        : {}),
      ...(releasesRoomMembers ? { releasesRoomMembers: true as const } : {}),
      ...(step.releasedMembers.length > 0
        ? { releasesMembers: [...step.releasedMembers] }
        : {}),
      speakingChanges: speakingChangesOf({
        rules,
        participants: step.state.cast,
        changes,
        segmentIdOf,
        floorChange: step.floorChange,
      }),
      round: {
        ...lifecycleColumnsOf(clock.lifecycle),
        currentStage: stageOf(clock, rules.segments.length),
        checkpoint: storedCheckpointOf(step.state.clock.checkpoint),
      },
      segmentInserts,
      segmentCloses,
      ...(segmentReturns.length > 0 ? { segmentReturns } : {}),
      ...(incidentChanges.length > 0 ? { incidentChanges } : {}),
      effects: [...step.effects],
    },
  };
};
