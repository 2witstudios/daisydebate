import { instantMs, tryInstantMs } from '@daisy/clock';
import { speakingChangesOf } from './round-speaking';
import { closePlayedRound, startRound } from './round-commands';
import { roundHoldsMembers } from './room-membership';
import { applyPanelCompletion } from './round-panel-completion';
import type { RoundRuntime } from './round-runtime-api';
import { applyRoundAdjudication } from './round-adjudication';
import { assertAttendanceRules } from './attendance-policy';
import { createInvariantError } from '@daisy/errors';
import {
  heldSeatsComplete,
  leadSeatOf,
  runtimeCheckpointSchema,
  type SideKey,
  type HydratedRound,
  type HydratedSegment,
  type RoundParticipantSeat,
  type RoundPosition,
  type RoundIncidentChange,
  type RoundProjection,
  type SegmentInsert,
  type SegmentClose,
  type RoundRules,
  type RuntimeCheckpoint,
} from '@daisy/protocol';
import { advanceRoundClock } from './round-clock';
import {
  closeClockSegment,
  type ClockTransition,
} from './round-clock-transition';
import {
  abandonedLifecycle,
  closedCount,
  normalizeRoundClock,
} from './round-clock-state';
import { debateSideOf } from './round-command-legality';
import {
  applyRoundCommand,
  debateIsOver,
  type Queues,
  type CommandContext,
} from './round-commands';
import {
  lifecycleColumnsOf,
  positionAtState,
  stageOf,
} from './round-position-projection';
import { incidentTransition } from './round-incident';
import { startGateTransition } from './round-start-gate';
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
  releasedMembers: [],
  floorChange: null,
  finalPlayedEnd: null,
});

/**
 * Creates the runtime from durable rows, the frozen rules and an injected
 * id source for projected segment rows. Hydration refuses durable state
 * that disagrees with `rules`: a segment row whose key or duration does not
 * match the rules it claims to execute is corruption, not position.
 */
/** The clock a Round's rows hydrate to. The stored stage is its projection; one that disagrees is corruption. */
const hydratedClock = (
  input: Parameters<typeof normalizeRoundClock>[0] & {
    readonly round: Pick<HydratedRound, 'currentStage'>;
  },
) => {
  const clock = normalizeRoundClock(input);
  if (input.round.currentStage !== stageOf(clock, input.rules.segments.length))
    throw createInvariantError(
      debateInvariantIds.stageMatchesClock,
      'The stored stage is not the one the Round clock derives',
    );
  return clock;
};

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
  let store: RoundStore = createRoundStore(hydratedClock(input));
  const segmentIds = new Map(
    input.segments.map((row) => [row.sequence, row.id]),
  );
  /** A segment's id: hydrated, or allocated when this runtime opened it. */
  const segmentIdOf = (sequence: number): string => {
    const id = segmentIds.get(sequence);
    if (id === undefined)
      throw createInvariantError(
        debateInvariantIds.segmentMatchesRules,
        'A clock change names a segment that was never opened',
      );
    return id;
  };

  const capture = (on: RoundStore) => captureRoundStore(on);
  /** An internal decision applied on a scratch copy, kept only if it succeeds. */
  const onScratch = (now: number, apply: (c: CommandContext) => void) => {
    const scratch = restoreRoundStore(capture(store));
    const into = queues();
    apply(contextOn(scratch, into, null, now));
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
    on.setPrepConsumed(checkpoint.prep_consumed_ms);
    if (checkpoint.active_prep === null) on.endPrep();
    if (checkpoint.floor === null) on.clearFloor();
    on.setIncident(checkpoint);
    on.setPrepEndedAt(checkpoint.prep_ended_at);
    on.setStartGate(checkpoint.start_gate);
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
          lead: leadSeatOf(expected.speak),
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
    const segmentInserts: SegmentInsert[] = into.changes.flatMap((change) => {
      if (change.kind !== 'open') return [];
      const id = input.nextSegmentId();
      segmentIds.set(change.row.sequence, id);
      return [
        {
          id,
          sequence: change.row.sequence,
          type: change.row.type,
          rulesSegmentKey: change.row.key,
          startedAt: new Date(change.row.startedAtMs).toISOString(),
          durationMs: change.row.durationMs,
        },
      ];
    });
    const segmentCloses: SegmentClose[] = into.changes.flatMap((change) =>
      change.kind === 'close'
        ? [
            {
              id: segmentIdOf(change.sequence),
              endedAt: new Date(change.atMs).toISOString(),
            },
          ]
        : [],
    );
    const segmentReturns = into.changes.flatMap((change) =>
      change.kind === 'resume'
        ? [
            {
              id: segmentIdOf(change.sequence),
              returnedMs: change.returnedMs,
            },
          ]
        : [],
    );
    const incidentChanges = into.changes.flatMap(
      (change): RoundIncidentChange[] =>
        change.kind !== 'incident'
          ? []
          : change.change.kind === 'opened'
            ? // The runtime's id source names every row it projects.
              [{ ...change.change, id: input.nextSegmentId() }]
            : [change.change],
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
      ...(into.releasedMembers.length > 0
        ? { releasesMembers: [...into.releasedMembers] }
        : {}),
      speakingChanges: speakingChangesOf({
        rules,
        participants: input.participants,
        changes: into.changes,
        segmentIdOf,
        floorChange: into.floorChange,
      }),
      round,
      segmentInserts,
      segmentCloses,
      ...(segmentReturns.length > 0 ? { segmentReturns } : {}),
      ...(incidentChanges.length > 0 ? { incidentChanges } : {}),
      effects: into.effects,
    };
  };

  const seatOf = (actorId: string | null): RoundParticipantSeat | null =>
    actorId === null
      ? null
      : (input.participants.find((seat) => seat.actorId === actorId) ?? null);

  const sideOf = (actorId: string | null): SideKey | null =>
    debateSideOf(seatOf(actorId));

  /** Every declared seat is held exactly once, and no other (ADR 0058 §8). */
  const assertSeatCompleteness = (): void => {
    if (
      !heldSeatsComplete(
        rules,
        input.participants.map((participant) => participant.seat),
      )
    )
      throw createInvariantError(
        debateInvariantIds.seatCompleteness,
        'The held seats are not exactly the seats the rules declare',
      );
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
    closeRowAt: (sequence, at) =>
      transitionOn(on, into, closeClockSegment(capture(on), sequence, at)),
  });

  const roundBlockOf = (on: RoundStore): RoundProjection['round'] => {
    const lifecycle = on.lifecycle();
    return {
      ...lifecycleColumnsOf(lifecycle),
      currentStage: stageOf(capture(on), rules.segments.length),
      checkpoint: on.checkpoint(),
    };
  };

  return {
    position(now: string): RoundPosition {
      return positionAtState(capture(store), rules, instantMs(now));
    },
    debateOverAt(now): boolean {
      const at = instantMs(now);
      const scratch = restoreRoundStore(capture(store));
      const into = queues();
      advance(scratch, into, at);
      return debateIsOver(contextOn(scratch, into, null, at));
    },
    execute({ command, actorId, now }): RoundProjection {
      const at = instantMs(now);
      const scratch = restoreRoundStore(capture(store));
      const into = queues();
      advance(scratch, into, at);
      applyRoundCommand(contextOn(scratch, into, actorId, at), command);
      store = scratch;
      return project(into);
    },
    adjudicate(decision): RoundProjection {
      const at = instantMs(decision.now);
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
    stop: (now) =>
      onScratch(instantMs(now), (c) => {
        const ending = abandonedLifecycle(c.on.lifecycle(), c.now);
        closePlayedRound(c);
        c.on.setLifecycle(ending);
      }),
    completePanel: (completion) => {
      const at = tryInstantMs(completion.now);
      if (at === undefined)
        throw createInvariantError(
          debateInvariantIds.panelPlayedRound,
          'Panel completion requires a valid clock',
        );
      return onScratch(at, (c) =>
        applyPanelCompletion(c, completion, input.participants),
      );
    },
    /**
     * The opening has run: the Round becomes active at the instant it ended,
     * and the clock catches up to `now`, so a late sweep cannot move the
     * countdown.
     */
    activate({ at, now }): RoundProjection {
      const scratch = restoreRoundStore(capture(store));
      const into = queues();
      const c = contextOn(scratch, into, null, instantMs(at));
      startRound(c);
      advance(scratch, into, instantMs(now));
      store = scratch;
      return project(into);
    },
    applyStartGate(event): RoundProjection {
      const scratch = restoreRoundStore(capture(store));
      const into = queues();
      advance(scratch, into, event.atMs);
      transitionOn(
        scratch,
        into,
        startGateTransition(capture(scratch), rules.countdownMs, event),
      );
      advance(scratch, into, event.atMs);
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
      advance(store, into, instantMs(now));
      return project(into);
    },
    checkpoint(): RuntimeCheckpoint {
      return runtimeCheckpointSchema.parse(store.checkpoint());
    },
  };
}
