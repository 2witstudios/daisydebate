import { createInvariantError } from '@daisy/errors';
import {
  debateSides,
  runtimeCheckpointSchema,
  type DebateRole,
  type DebateSide,
  type RoundRules,
  type RuntimeCheckpoint,
} from '@daisy/protocol';
import { applyRoundCommand } from './round-commands';
import { roundPositionOf, stageOf } from './round-position';
import {
  type HydratedRound,
  type HydratedSegment,
  type Queues,
  type RoundCommand,
  type RoundParticipantSeat,
  type RoundPosition,
  type RoundProjection,
} from './round-contracts';
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

const iso = (ms: number): string => new Date(ms).toISOString();

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

  const closedCountOn = (on: RoundStore): number =>
    on.rows().filter((row) => row.endedAtMs !== null).length;

  /** Prep expiry: the instant the budget runs out, or null while it lasts. */
  const prepExpiresAt = (on: RoundStore): number | null => {
    const active = on.checkpoint().active_prep;
    if (active === null) return null;
    const startedAtMs = Date.parse(active.started_at);
    const budget = rules.inRoundPrep?.budgetMsPerSide ?? 0;
    return (
      startedAtMs +
      Math.max(0, budget - on.checkpoint().prep_consumed_ms[active.side])
    );
  };

  /** True when the open segment is still inside its time and not final. */
  const openStillRunning = (on: RoundStore, now: number): boolean => {
    const open = on.openRow();
    if (open === undefined) return false;
    if (now < open.startedAtMs + open.durationMs) return true;
    // The final segment stays open past its time: the round is spoken but
    // not completed, and the open row remains the live interval until
    // `complete` closes it with the outcome.
    return open.sequence === rules.segments.length - 1;
  };

  /** The open segment's due instant, once its time is spent. */
  const dueAtOf = (on: RoundStore): number =>
    on.openRow()!.startedAtMs + on.openRow()!.durationMs;

  /** Closes the live segment and returns; false when nothing was due. */
  const closeIfDue = (on: RoundStore, into: Queues, now: number): boolean => {
    if (openStillRunning(on, now)) return false;
    const open = on.openRow();
    if (open === undefined) return false;
    closeRow(on, into, open, dueAtOf(on));
    return true;
  };

  /** Runs one prep-or-countdown step; false when the gap is not over. */
  const advanceGap = (on: RoundStore, into: Queues, now: number): boolean => {
    if (closedCountOn(on) >= rules.segments.length) return false;
    const expiresAt = prepExpiresAt(on);
    if (expiresAt !== null) {
      if (now < expiresAt) return false;
      const active = on.checkpoint().active_prep!;
      on.setPrepConsumed(active.side, rules.inRoundPrep?.budgetMsPerSide ?? 0);
      on.endPrep();
      openRowOn(on, into, expiresAt);
      return true;
    }
    const countdownEndsAt =
      (on.lifecycle().gapAnchorMs ?? now) + rules.countdownMs;
    if (now < countdownEndsAt) return false;
    openRowOn(on, into, countdownEndsAt);
    return true;
  };

  const advance = (on: RoundStore, into: Queues, now: number): void => {
    if (on.lifecycle().status !== 'active') return;
    for (;;) {
      if (on.openRow() !== undefined) {
        // A live segment: the only work time can do is close it when due.
        if (!closeIfDue(on, into, now)) return;
        continue;
      }
      if (!advanceGap(on, into, now)) return;
    }
  };

  const closeRow = (
    on: RoundStore,
    into: Queues,
    row: { readonly id: string },
    at: number,
  ): void => {
    on.closeSegment({ id: row.id, endedAtMs: at });
    on.clearFloor();
    on.setLifecycle({ gapAnchorMs: at });
    into.closes.push({ id: row.id, endedAt: iso(at) });
    into.effects.push({
      kind: 'segment_closed',
      key: keyOf(on, row.id),
      at: iso(at),
    });
  };

  const keyOf = (on: RoundStore, id: string): string =>
    on.rows().find((row) => row.id === id)?.key ?? '';

  const openRowOn = (on: RoundStore, into: Queues, at: number): void => {
    if (on.openRow() !== undefined)
      throw createInvariantError(
        debateInvariantIds.liveOpenSegmentCount,
        'A segment opened while another is still open',
      );
    const sequence = closedCountOn(on);
    const expected = rules.segments[sequence];
    if (!expected)
      throw createInvariantError(
        debateInvariantIds.liveOpenSegmentCount,
        'No resolved segment remains to open',
      );
    const id = input.nextSegmentId();
    on.insertSegment({
      id,
      sequence,
      type: expected.type,
      key: expected.key,
      startedAtMs: at,
      durationMs: expected.durationMs,
    });
    into.inserts.push({
      id,
      sequence,
      type: expected.type,
      rulesSegmentKey: expected.key,
      startedAt: iso(at),
      durationMs: expected.durationMs,
    });
    into.effects.push({
      kind: 'segment_opened',
      key: expected.key,
      side: expected.side,
      type: expected.type,
      at: iso(at),
    });
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
      if (
        held.length !== wanted ||
        !held.every((slot, index) => slot === index)
      )
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
        closedCount: () => closedCountOn(on),
        seatOf,
        sideOf,
        floorHolder: floorHolderSeat,
        assertSeatCompleteness,
        openRowAt: (at) => openRowOn(on, into, at),
        closeRowAt: (id, at) => closeRow(on, into, { id }, at),
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
      startedAt:
        lifecycle.startedAtMs === null ? null : iso(lifecycle.startedAtMs),
      completedAt:
        lifecycle.completedAtMs === null ? null : iso(lifecycle.completedAtMs),
      outcome: lifecycle.outcome,
      checkpoint: on.checkpoint(),
    };
  };

  return {
    position(now: string): RoundPosition {
      const at = Date.parse(now);
      const scratch = restoreRoundStore(captureRoundStore(store));
      advance(scratch, queues(), at);
      return positionOfStore(scratch, at);
    },
    execute({ command, actorId, now }): RoundProjection {
      const at = Date.parse(now);
      const before = captureRoundStore(store);
      const scratch = restoreRoundStore(before);
      const into = queues();
      advance(scratch, into, at);
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
      advance(store, into, at);
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
