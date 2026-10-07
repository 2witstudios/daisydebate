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
  type RoundProjection,
  type RoundRules,
  type RuntimeCheckpoint,
} from '@daisy/protocol';
import { createRoundClock } from './round-clock';
import { applyRoundCommand, type Queues } from './round-commands';
import { lifecycleStampsOf, roundPositionOf, stageOf } from './round-position';
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
const queues = (): Queues => ({ inserts: [], closes: [], effects: [] });

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
  /** Advances time alone, projecting whatever the clock moved. */
  readonly tick: (now: string) => RoundProjection;
  /** The current checkpoint. */
  readonly checkpoint: () => RuntimeCheckpoint;
} {
  const rules = input.rules;
  const clock = createRoundClock({
    rules,
    nextSegmentId: input.nextSegmentId,
  });
  const hydratedRows = input.segments
    .map((segment) => ({
      id: segment.id,
      sequence: segment.sequence,
      type: segment.type,
      key: segment.rulesSegmentKey,
      startedAtMs: Date.parse(segment.startedAt),
      endedAtMs: segment.endedAt === null ? null : Date.parse(segment.endedAt),
      durationMs: segment.durationMs,
    }))
    .sort((a, b) => a.sequence - b.sequence);

  // Hydration integrity: rows execute exactly the rules they name.
  hydratedRows.forEach((row, index) => {
    const expected = rules.segments[index];
    if (
      !expected ||
      row.sequence !== index ||
      row.key !== expected.key ||
      row.durationMs !== expected.durationMs
    )
      throw createInvariantError(
        debateInvariantIds.segmentMatchesRules,
        'A durable segment row disagrees with the resolved rules',
      );
    if (row.endedAtMs === null && index !== hydratedRows.length - 1)
      throw createInvariantError(
        debateInvariantIds.liveOpenSegmentCount,
        'An open segment row is followed by another row',
      );
  });

  const lastClosed = hydratedRows
    .filter((row) => row.endedAtMs !== null)
    .at(-1);

  let store: RoundStore = createRoundStore({
    lifecycle: {
      status: input.round.status,
      startedAtMs:
        input.round.startedAt === null
          ? null
          : Date.parse(input.round.startedAt),
      completedAtMs:
        input.round.completedAt === null
          ? null
          : Date.parse(input.round.completedAt),
      outcome: input.round.outcome,
      gapAnchorMs:
        lastClosed !== undefined
          ? lastClosed.endedAtMs
          : input.round.startedAt === null
            ? null
            : Date.parse(input.round.startedAt),
    },
    checkpoint: input.checkpoint,
    rows: hydratedRows,
  });
  let pending: Queues = queues();

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

  /** Applies one command through the extracted dispatcher (ADR 0058 §6). */
  const apply = (
    on: RoundStore,
    into: Queues,
    command: RoundCommand,
    actorId: string | null,
    now: number,
  ): void =>
    applyRoundCommand(
      {
        rules,
        on,
        into,
        actorId,
        now,
        closedCount: () => clock.closedCountOn(on),
        seatOf,
        sideOf,
        floorHolder: floorHolderSeat,
        assertSeatCompleteness,
        openRowAt: (at) => clock.openRowOn(on, into, at),
        closeRowAt: (id, at) => clock.closeRow(on, into, { id }, at),
      },
      command,
    );

  /** The full position of one store at `now`; pure over its input. */
  const positionOfStore = (on: RoundStore, now: number): RoundPosition =>
    roundPositionOf(on, now, rules);

  const roundBlockOf = (on: RoundStore): RoundProjection['round'] => {
    const lifecycle = on.lifecycle();
    return {
      status: lifecycle.status,
      currentStage: stageOf(on, lifecycle.status),
      ...lifecycleStampsOf(lifecycle),
      checkpoint: on.checkpoint(),
    };
  };

  return {
    position(now: string): RoundPosition {
      const at = Date.parse(now);
      const scratch = restoreRoundStore(captureRoundStore(store));
      clock.advance(scratch, queues(), at);
      return positionOfStore(scratch, at);
    },
    execute({ command, actorId, now }): RoundProjection {
      const at = Date.parse(now);
      const before = captureRoundStore(store);
      const scratch = restoreRoundStore(before);
      const into = queues();
      clock.advance(scratch, into, at);
      try {
        apply(scratch, into, command, actorId, at);
      } catch (error) {
        // A refused command leaves the runtime state unchanged, including
        // anything the time advancement queued before the refusal.
        store = restoreRoundStore(before);
        pending = queues();
        throw error;
      }
      store = scratch;
      pending = into;
      return {
        round: roundBlockOf(store),
        segmentInserts: pending.inserts,
        segmentCloses: pending.closes,
        effects: pending.effects,
      };
    },
    tick(now): RoundProjection {
      const at = Date.parse(now);
      const into = queues();
      clock.advance(store, into, at);
      pending = into;
      return {
        round: roundBlockOf(store),
        segmentInserts: pending.inserts,
        segmentCloses: pending.closes,
        effects: pending.effects,
      };
    },
    checkpoint(): RuntimeCheckpoint {
      return runtimeCheckpointSchema.parse(store.checkpoint());
    },
  };
}
