import { speakingChangesOf } from './round-speaking';
import { applyUnjudgedCompletion } from './round-unjudged';
import {
  applyRoundAdjudication,
  type RoundAdjudication,
} from './round-adjudication';
import { assertAttendanceRules } from './attendance-policy';
import { createInvariantError } from '@daisy/errors';
import {
  debateSides,
  runtimeCheckpointSchema,
  seatSlotsComplete,
  type DebateRole,
  type DebateSide,
  type HydratedRound,
  type HydratedSegment,
  type RoundCommand,
  type RoundParticipantSeat,
  type RoundPosition,
  type RoundUnjudgedCompletion,
  type RoundProjection,
  type SegmentInsert,
  type SegmentClose,
  type RoundRules,
  type RuntimeCheckpoint,
} from '@daisy/protocol';
import {
  advanceRoundClock,
  openClockSegment,
  closeClockSegment,
  type ClockTransition,
} from './round-clock';
import { closedCount, normalizeRoundClock } from './round-clock-state';
import {
  applyRoundCommand,
  type Queues,
  type CommandContext,
} from './round-commands';
import {
  lifecycleStampsOf,
  positionAtState,
  stageOf,
} from './round-position-projection';
import { debateInvariantIds } from './invariant-ids';
import {
  captureRoundStore,
  createRoundStore,
  restoreRoundStore,
  type RoundStore,
} from './round-ecs-store';

/**
 * The one round runtime (ADR 0058): execution over durable state. Postgres
 * is truth — the open `round_segments` row is the live interval — and this
 * runtime derives the round's position from the resolved rules, the durable
 * rows and an injected `now`, accepts the legal commands, and projects the
 * durable writes that materialize its state. The AI is an actor
 * implementation here: a bot seat receives the same commands a human's seat
 * would, submitted by orchestration. A refused command leaves the runtime
 * state unchanged.
 */

/** The queues the runtime projects from; a scratch run discards its own. */
const queues = (): Queues => ({
  changes: [],
  effects: [],
  floorChange: null,
  finalPlayedEnd: null,
});

/**
 * Creates the runtime from durable rows, the frozen rules and an injected
 * id source for projected segment rows. Hydration refuses durable state
 * that disagrees with `rules`: a segment row whose key or duration does not
 * match the rules it claims to execute is corruption, not position.
 */
export function createRoundRuntime(input: {
  readonly round: HydratedRound;
  readonly rules: RoundRules;
  readonly participants: readonly RoundParticipantSeat[];
  readonly checkpoint: unknown;
  readonly segments: readonly HydratedSegment[];
  /** Minted for each projected segment insert; injected, never ambient. */
  readonly nextSegmentId: () => string;
}): {
  /** The derived position at `now`; a pure read. */
  readonly position: (now: string) => RoundPosition;
  /** Applies one legal command and returns the writes to persist. */
  readonly execute: (input: {
    readonly command: RoundCommand;
    readonly actorId: string | null;
    readonly now: string;
  }) => RoundProjection;
  /** Internal durable attendance decision; never a public command. */
  readonly adjudicate: (input: RoundAdjudication) => RoundProjection;
  /** Internal completion after durable freeze/attendance verification; does not advance time. */
  readonly completeUnjudged: (
    input: RoundUnjudgedCompletion,
  ) => RoundProjection;
  /** Advances time alone, projecting whatever the clock moved. */
  readonly tick: (now: string) => RoundProjection;
  /** The current checkpoint. */
  readonly checkpoint: () => RuntimeCheckpoint;
} {
  const rules = input.rules;
  assertAttendanceRules(rules);
  let store: RoundStore = createRoundStore(normalizeRoundClock(input));
  const segmentIds = new Map(
    input.segments.map((row) => [row.sequence, row.id]),
  );

  const capture = (on: RoundStore) => captureRoundStore(on);
  const transitionOn = (
    on: RoundStore,
    into: Queues,
    transition: ClockTransition,
  ): void => {
    for (const change of transition.changes) {
      if (change.kind === 'open') on.insertSegment(change.row);
      else
        on.closeSegment({ sequence: change.sequence, endedAtMs: change.atMs });
    }
    const checkpoint = transition.state.checkpoint;
    for (const side of debateSides)
      on.setPrepConsumed(side, checkpoint.prep_consumed_ms[side]);
    if (checkpoint.active_prep === null) on.endPrep();
    if (checkpoint.floor === null) on.clearFloor();
    into.changes.push(...transition.changes);
    for (const change of transition.changes) {
      if (change.kind === 'close')
        into.effects.push({
          kind: 'segment_closed',
          key: change.key,
          at: new Date(change.atMs).toISOString(),
        });
      else {
        const expected = rules.segments[change.row.sequence]!;
        into.effects.push({
          kind: 'segment_opened',
          key: expected.key,
          side: expected.side,
          type: expected.type,
          at: new Date(change.row.startedAtMs).toISOString(),
        });
      }
    }
  };
  const advance = (on: RoundStore, into: Queues, at: number): void =>
    transitionOn(on, into, advanceRoundClock(capture(on), rules, at));
  const project = (into: Queues): RoundProjection => {
    // IDs are allocated only after pure execution has been accepted, once per opening.
    for (const change of into.changes)
      if (change.kind === 'open')
        segmentIds.set(change.row.sequence, input.nextSegmentId());
    const segmentInserts: SegmentInsert[] = into.changes.flatMap((change) =>
      change.kind === 'open'
        ? [
            {
              id: segmentIds.get(change.row.sequence)!,
              sequence: change.row.sequence,
              type: change.row.type,
              rulesSegmentKey: change.row.key,
              startedAt: new Date(change.row.startedAtMs).toISOString(),
              durationMs: change.row.durationMs,
            },
          ]
        : [],
    );
    const segmentCloses: SegmentClose[] = into.changes.flatMap((change) =>
      change.kind === 'close'
        ? [
            {
              id: segmentIds.get(change.sequence)!,
              endedAt: new Date(change.atMs).toISOString(),
            },
          ]
        : [],
    );
    const finalClose = into.changes.find(
      (change) =>
        change.kind === 'close' &&
        change.sequence === rules.segments.length - 1,
    );
    const finalEndedAt =
      into.finalPlayedEnd ??
      (finalClose?.kind === 'close'
        ? new Date(finalClose.atMs).toISOString()
        : undefined);
    return {
      ...(finalEndedAt !== undefined
        ? { finalSegmentEndedAt: finalEndedAt }
        : {}),
      speakingChanges: speakingChangesOf({
        rules,
        participants: input.participants,
        changes: into.changes,
        segmentIds,
        floorChange: into.floorChange,
      }),
      round: roundBlockOf(store),
      segmentInserts,
      segmentCloses,
      effects: into.effects,
    };
  };

  const seatOf = (actorId: string | null): RoundParticipantSeat | null =>
    actorId === null
      ? null
      : (input.participants.find((seat) => seat.actorId === actorId) ?? null);

  const sideOf = (actorId: string | null): DebateSide | null => {
    const seat = seatOf(actorId);
    return seat !== null &&
      (debateSides as readonly string[]).includes(seat.role)
      ? (seat.role as DebateSide)
      : null;
  };

  /**
   * Who may act right now: the floor holder after an accepted interruption,
   * else the open segment's scheduled seat.
   */
  const floorHolderSeat = (on: RoundStore): RoundParticipantSeat | null => {
    const open = on.openRow();
    if (open === undefined) return null;
    const floor = on.checkpoint().floor;
    if (floor !== null)
      return (
        input.participants.find(
          (seat) => seat.id === floor.holder_participant_id,
        ) ?? null
      );
    const expected = rules.segments[open.sequence]!;
    return (
      input.participants.find(
        (seat) => seat.role === expected.side && seat.slot === expected.slot,
      ) ?? null
    );
  };

  const assertSeatCompleteness = (): void => {
    for (const role of Object.keys(rules.seats) as DebateRole[]) {
      const wanted = rules.seats[role];
      const held = input.participants
        .filter((seat) => seat.role === role)
        .map((seat) => seat.slot)
        .sort((a, b) => a - b);
      if (!seatSlotsComplete(wanted, held))
        throw createInvariantError(
          debateInvariantIds.seatCompleteness,
          `Held ${role} slots are not exactly 0..${wanted - 1}`,
        );
    }
  };

  const contextOn = (
    on: RoundStore,
    into: Queues,
    actorId: string | null,
    now: number,
  ): CommandContext => ({
    rules,
    on,
    into,
    actorId,
    now,
    closedCount: () => closedCount(capture(on)),
    seatOf,
    sideOf,
    floorHolder: floorHolderSeat,
    assertSeatCompleteness,
    openRowAt: (at) =>
      transitionOn(on, into, openClockSegment(capture(on), rules, at)),
    closeRowAt: (sequence, at) =>
      transitionOn(on, into, closeClockSegment(capture(on), sequence, at)),
  });

  const roundBlockOf = (on: RoundStore): RoundProjection['round'] => {
    const lifecycle = on.lifecycle();
    return {
      status: lifecycle.status,
      currentStage: stageOf(
        capture(on),
        lifecycle.status,
        rules.segments.length,
      ),
      ...lifecycleStampsOf(lifecycle),
      checkpoint: on.checkpoint(),
    };
  };

  return {
    position(now: string): RoundPosition {
      return positionAtState(capture(store), rules, Date.parse(now));
    },
    execute({ command, actorId, now }): RoundProjection {
      const at = Date.parse(now);
      const scratch = restoreRoundStore(capture(store));
      const into = queues();
      advance(scratch, into, at);
      applyRoundCommand(contextOn(scratch, into, actorId, at), command);
      store = scratch;
      return project(into);
    },
    adjudicate(decision): RoundProjection {
      const at = Date.parse(decision.now);
      const scratch = restoreRoundStore(capture(store));
      const into = queues();
      advance(scratch, into, at);
      applyRoundAdjudication(
        contextOn(scratch, into, null, at),
        decision,
        input.segments,
        input.participants,
      );
      store = scratch;
      return project(into);
    },
    completeUnjudged(completion): RoundProjection {
      const scratch = restoreRoundStore(capture(store));
      const into = queues();
      applyUnjudgedCompletion(
        contextOn(scratch, into, null, Date.parse(completion.now)),
        completion,
        input.participants.filter((seat) => seat.role === 'judge').length,
      );
      store = scratch;
      return project(into);
    },
    tick(now): RoundProjection {
      const into = queues();
      advance(store, into, Date.parse(now));
      return project(into);
    },
    checkpoint(): RuntimeCheckpoint {
      return runtimeCheckpointSchema.parse(store.checkpoint());
    },
  };
}
