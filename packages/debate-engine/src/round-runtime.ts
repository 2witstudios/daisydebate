import { speakingChangesOf } from './round-speaking';
import { startRound } from './round-commands';
import { roundHoldsMembers } from './room-membership';
import { applyPanelCompletion } from './round-panel-completion';
import type { RoundRuntime } from './round-runtime-api';
import { applyRoundAdjudication } from './round-adjudication';
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
  type RoundParticipantSeat,
  type RoundPosition,
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
import { debateSideOf } from './round-command-legality';
import {
  applyRoundCommand,
  debateIsOver,
  type Queues,
  type CommandContext,
} from './round-commands';
import {
  lifecycleStampsOf,
  positionAtState,
  stageOf,
} from './round-position-projection';
import { incidentTransition } from './round-incident';
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
}): RoundRuntime {
  const rules = input.rules;
  assertAttendanceRules(rules);
  let store: RoundStore = createRoundStore(normalizeRoundClock(input));
  const segmentIds = new Map(
    input.segments.map((row) => [row.sequence, row.id]),
  );

  const capture = (on: RoundStore) => captureRoundStore(on);
  /** An internal decision applied on a scratch copy, kept only if it succeeds. */
  const onScratch = (now: string, apply: (c: CommandContext) => void) => {
    const scratch = restoreRoundStore(capture(store));
    const into = queues();
    apply(contextOn(scratch, into, null, Date.parse(now)));
    store = scratch;
    return project(into);
  };
  const transitionOn = (
    on: RoundStore,
    into: Queues,
    transition: ClockTransition,
  ): void => {
    for (const change of transition.changes) {
      if (change.kind === 'open') on.insertSegment(change.row);
      else if (change.kind === 'close')
        on.closeSegment({ sequence: change.sequence, endedAtMs: change.atMs });
      else if (change.kind === 'resume')
        on.returnSegment({
          sequence: change.sequence,
          returnedMs: change.returnedMs,
        });
    }
    const checkpoint = transition.state.checkpoint;
    for (const side of debateSides)
      on.setPrepConsumed(side, checkpoint.prep_consumed_ms[side]);
    if (checkpoint.active_prep === null) on.endPrep();
    if (checkpoint.floor === null) on.clearFloor();
    on.setIncident(checkpoint);
    into.changes.push(...transition.changes);
    for (const change of transition.changes) {
      if (change.kind === 'close')
        into.effects.push({
          kind: 'segment_closed',
          key: change.key,
          at: new Date(change.atMs).toISOString(),
        });
      else if (change.kind === 'open') {
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
    const segmentReturns = into.changes.flatMap((change) =>
      change.kind === 'resume'
        ? [
            {
              id: segmentIds.get(change.sequence)!,
              returnedMs: change.returnedMs,
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
    const round = roundBlockOf(store);
    // This revision stops the Round holding its Room's members (ADR 0070).
    const releasesRoomMembers = !roundHoldsMembers({
      status: store.lifecycle().status,
      debateEnded: finalEndedAt !== undefined,
    });
    return {
      ...(finalEndedAt !== undefined
        ? { finalSegmentEndedAt: finalEndedAt }
        : {}),
      ...(releasesRoomMembers ? { releasesRoomMembers: true as const } : {}),
      speakingChanges: speakingChangesOf({
        rules,
        participants: input.participants,
        changes: into.changes,
        segmentIds,
        floorChange: into.floorChange,
      }),
      round,
      segmentInserts,
      segmentCloses,
      ...(segmentReturns.length > 0 ? { segmentReturns } : {}),
      effects: into.effects,
    };
  };

  const seatOf = (actorId: string | null): RoundParticipantSeat | null =>
    actorId === null
      ? null
      : (input.participants.find((seat) => seat.actorId === actorId) ?? null);

  const sideOf = (actorId: string | null): DebateSide | null =>
    debateSideOf(seatOf(actorId));

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
    participants: input.participants,
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
      currentStage: stageOf(capture(on), rules.segments.length),
      ...lifecycleStampsOf(lifecycle),
      checkpoint: on.checkpoint(),
    };
  };

  return {
    position(now: string): RoundPosition {
      return positionAtState(capture(store), rules, Date.parse(now));
    },
    debateOverAt(now): boolean {
      const at = Date.parse(now);
      const scratch = restoreRoundStore(capture(store));
      const into = queues();
      advance(scratch, into, at);
      return debateIsOver(contextOn(scratch, into, null, at));
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
    completePanel: (completion) =>
      onScratch(completion.now, (c) =>
        applyPanelCompletion(c, completion, input.participants),
      ),
    /**
     * The opening has run: the Round becomes active at the instant it ended,
     * and the clock catches up to `now`, so a late sweep cannot move the
     * countdown.
     */
    activate({ at, now }): RoundProjection {
      const scratch = restoreRoundStore(capture(store));
      const into = queues();
      const c = contextOn(scratch, into, null, Date.parse(at));
      startRound(c);
      advance(scratch, into, Date.parse(now));
      store = scratch;
      return project(into);
    },
    /** A server-detected platform incident; the clock catches up to its instant first. */
    applyIncident(event): RoundProjection {
      const scratch = restoreRoundStore(capture(store));
      const into = queues();
      advance(scratch, into, event.atMs);
      const transition = incidentTransition(capture(scratch), rules, event);
      transitionOn(scratch, into, transition);
      const ended =
        transition.state.lifecycle.status !== scratch.lifecycle().status;
      scratch.setLifecycle(transition.state.lifecycle);
      if (ended) {
        scratch.endPrep();
        const lastPlayed = scratch.rows().at(-1)?.endedAtMs;
        if (lastPlayed !== undefined && lastPlayed !== null)
          into.finalPlayedEnd = new Date(lastPlayed).toISOString();
      }
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
