import { createAppError, createInvariantError } from '@daisy/errors';
import {
  debateSides,
  runtimeCheckpointSchema,
  type DebateRole,
  type DebateSide,
  type RatedOutcome,
  type RoundRules,
  type RoundStage,
  type RoundStatus,
  type RuntimeCheckpoint,
  type SegmentType,
} from '@daisy/protocol';
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

export type HydratedRound = {
  readonly id: string;
  readonly status: RoundStatus;
  readonly currentStage: RoundStage | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly outcome: RatedOutcome | null;
};

/** One `round_segments` row, hydrated. */
export type HydratedSegment = {
  readonly id: string;
  readonly sequence: number;
  readonly type: SegmentType;
  readonly rulesSegmentKey: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly durationMs: number;
};

/** One `round_participants` row, hydrated. */
export type RoundParticipantSeat = {
  readonly id: string;
  readonly actorId: string;
  readonly role: DebateRole;
  readonly slot: number;
};

export type RoundCommand =
  | { readonly type: 'start' }
  | { readonly type: 'start_prep' }
  | { readonly type: 'start_speech' }
  | { readonly type: 'yield' }
  | { readonly type: 'interrupt' }
  | { readonly type: 'forfeit' }
  | { readonly type: 'complete'; readonly outcome: RatedOutcome };

/** A durable segment row the runtime opened and the caller must insert. */
export type SegmentInsert = {
  readonly id: string;
  readonly sequence: number;
  readonly type: SegmentType;
  readonly rulesSegmentKey: string;
  readonly startedAt: string;
  readonly durationMs: number;
};

/** A durable close the caller must write onto an existing segment row. */
export type SegmentClose = {
  readonly id: string;
  readonly endedAt: string;
};

/** What a command or a tick did, for outbox fan-out and AI wake. */
export type RoundEffect =
  | { readonly kind: 'round_started'; readonly at: string }
  | {
      readonly kind: 'segment_opened';
      readonly key: string;
      readonly side: DebateSide;
      readonly type: SegmentType;
      readonly at: string;
    }
  | {
      readonly kind: 'segment_closed';
      readonly key: string;
      readonly at: string;
    }
  | {
      readonly kind: 'prep_started';
      readonly side: DebateSide;
      readonly at: string;
    }
  | {
      readonly kind: 'round_completed';
      readonly outcome: RatedOutcome;
      readonly at: string;
    };

/** The durable writes that materialize the runtime's state. */
export type RoundProjection = {
  /** Null when no round-row column changed. */
  readonly round: {
    readonly status: RoundStatus;
    readonly currentStage: RoundStage | null;
    readonly startedAt: string | null;
    readonly completedAt: string | null;
    readonly outcome: RatedOutcome | null;
    readonly checkpoint: RuntimeCheckpoint;
  } | null;
  readonly segmentInserts: readonly SegmentInsert[];
  readonly segmentCloses: readonly SegmentClose[];
  readonly effects: readonly RoundEffect[];
};

/** The derived position at one instant: what UI and orchestration read. */
export type RoundPosition = {
  readonly status: RoundStatus;
  readonly stage: RoundStage | null;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly outcome: RatedOutcome | null;
  readonly openSegment: {
    readonly key: string;
    readonly label: string;
    readonly type: SegmentType;
    readonly side: DebateSide;
    readonly sequence: number;
    readonly startedAt: string;
    readonly endsAt: string;
    readonly remainingMs: number;
    /** The participant holding the floor; null when the scheduled side does. */
    readonly floorParticipantId: string | null;
  } | null;
  readonly nextSegment: {
    readonly key: string;
    readonly label: string;
    readonly type: SegmentType;
    readonly side: DebateSide;
    readonly sequence: number;
  } | null;
  readonly countdownRemainingMs: number | null;
  readonly prep: {
    readonly side: DebateSide;
    readonly remainingMs: number;
  } | null;
  /** Remaining budget per side; null when the format has no in-round prep. */
  readonly prepBudgetRemainingMs: Readonly<Record<DebateSide, number>> | null;
  /** True while the final segment has spoken but the outcome is not in. */
  readonly awaitingBallot: boolean;
};

type Queues = {
  inserts: SegmentInsert[];
  closes: SegmentClose[];
  effects: RoundEffect[];
};

const iso = (ms: number): string => new Date(ms).toISOString();

const other = (side: DebateSide): DebateSide =>
  side === 'affirmative' ? 'negative' : 'affirmative';

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

  const openRow = () => store.openRow();
  const rows = () => store.rows();
  const closedCount = () =>
    rows().filter((row) => row.endedAtMs !== null).length;

  /**
   * Time advancement: closes expired segments, expires running prep at its
   * budget, and opens segments whose countdown has elapsed. Repeats until
   * `now` falls inside whatever is current, so a restart catches up.
   */
  const advance = (on: RoundStore, into: Queues, now: number): void => {
    if (on.lifecycle().status !== 'active') return;
    for (;;) {
      const open = on.openRow();
      if (open !== undefined) {
        const endsAt = open.startedAtMs + open.durationMs;
        if (now < endsAt) return;
        // The final segment stays open past its time: the round is spoken
        // but not completed, and the open row remains the live interval
        // until `complete` closes it with the outcome.
        if (open.sequence === rules.segments.length - 1) return;
        closeRow(on, into, open, endsAt);
        continue;
      }
      const checkpoint = on.checkpoint();
      if (closedCountOn(on) >= rules.segments.length) return;
      const active = checkpoint.active_prep;
      if (active !== null) {
        const startedAtMs = Date.parse(active.started_at);
        const budget = rules.inRoundPrep?.budgetMsPerSide ?? 0;
        const expiresAt =
          startedAtMs +
          Math.max(0, budget - checkpoint.prep_consumed_ms[active.side]);
        if (now < expiresAt) return;
        on.setPrepConsumed(active.side, budget);
        on.endPrep();
        openRowOn(on, into, expiresAt);
        continue;
      }
      const lifecycle = on.lifecycle();
      const countdownEndsAt =
        (lifecycle.gapAnchorMs ?? now) + rules.countdownMs;
      if (now < countdownEndsAt) return;
      openRowOn(on, into, countdownEndsAt);
    }
  };

  const closedCountOn = (on: RoundStore): number =>
    on.rows().filter((row) => row.endedAtMs !== null).length;

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

  const apply = (
    on: RoundStore,
    into: Queues,
    command: RoundCommand,
    actorId: string | null,
    now: number,
  ): void => {
    const lifecycle = on.lifecycle();
    if (lifecycle.status === 'completed')
      throw createInvariantError(
        debateInvariantIds.completedIsTerminal,
        'Completed rounds are terminal',
      );
    if (lifecycle.status === 'abandoned')
      throw createAppError('CONFLICT', 'An abandoned round takes no commands');
    switch (command.type) {
      case 'start': {
        if (lifecycle.status !== 'scheduled')
          throw createAppError('CONFLICT', 'Only a scheduled round starts');
        assertSeatCompleteness();
        on.setLifecycle({
          status: 'active',
          startedAtMs: now,
          gapAnchorMs: now,
        });
        into.effects.push({ kind: 'round_started', at: iso(now) });
        return;
      }
      case 'start_prep': {
        if (on.openRow() !== undefined)
          throw createAppError('CONFLICT', 'A segment is already live');
        if (on.checkpoint().active_prep !== null)
          throw createAppError('CONFLICT', 'Prep is already running');
        const { inRoundPrep } = rules;
        if (inRoundPrep === null)
          throw createInvariantError(
            debateInvariantIds.prepRequiresCapability,
            'The resolved rules have no in-round prep',
          );
        const side = sideOf(actorId);
        if (side === null)
          throw createAppError('CONFLICT', 'Prep belongs to a seated debater');
        const sequence = closedCountOn(on);
        const upcoming = rules.segments[sequence];
        if (!upcoming)
          throw createInvariantError(
            debateInvariantIds.prepRequiresSpendableSegment,
            'No segment remains to prep for',
          );
        if (upcoming.side !== side)
          throw createInvariantError(
            debateInvariantIds.prepRequiresSpendableSegment,
            'Prep runs before the prepping side’s own segment',
          );
        if (!inRoundPrep.spendableBefore.includes(upcoming.type))
          throw createInvariantError(
            debateInvariantIds.prepRequiresSpendableSegment,
            `Prep is not spendable before a ${upcoming.type} segment`,
          );
        if (
          inRoundPrep.expiresAtSegment !== null &&
          rules.segments.findIndex(
            (segment) => segment.key === inRoundPrep.expiresAtSegment,
          ) <= sequence
        )
          throw createInvariantError(
            debateInvariantIds.prepRequiresSpendableSegment,
            `Prep expired at segment ${inRoundPrep.expiresAtSegment}`,
          );
        if (
          on.checkpoint().prep_consumed_ms[side] >= inRoundPrep.budgetMsPerSide
        )
          throw createInvariantError(
            debateInvariantIds.prepRequiresBudget,
            'The side’s prep budget is spent',
          );
        // Prep supersedes the rest of the countdown: the gap anchor hands
        // over to the prep clock anchored now.
        on.startPrep({ side, startedAtMs: now });
        on.setLifecycle({ gapAnchorMs: null });
        into.effects.push({ kind: 'prep_started', side, at: iso(now) });
        return;
      }
      case 'start_speech': {
        const active = on.checkpoint().active_prep;
        if (active === null)
          throw createInvariantError(
            debateInvariantIds.startSpeechRequiresPrep,
            'A speech opens out of the prepping side’s prep',
          );
        const side = sideOf(actorId);
        if (side === null || side !== active.side)
          throw createAppError(
            'CONFLICT',
            'Only the prepping side ends its own prep',
          );
        const elapsed = now - Date.parse(active.started_at);
        const budget = rules.inRoundPrep?.budgetMsPerSide ?? 0;
        on.setPrepConsumed(
          side,
          Math.min(
            budget,
            on.checkpoint().prep_consumed_ms[side] + Math.max(0, elapsed),
          ),
        );
        on.endPrep();
        openRowOn(on, into, now);
        return;
      }
      case 'yield': {
        const open = on.openRow();
        if (open === undefined)
          throw createInvariantError(
            debateInvariantIds.yieldRequiresFloor,
            'Yielding requires a live segment',
          );
        const seat = seatOf(actorId);
        const holder = floorHolderSeat(on);
        if (seat === null || holder === null || seat.id !== holder.id)
          throw createInvariantError(
            debateInvariantIds.yieldRequiresFloor,
            'Only the floor holder ends their own control',
          );
        if (rules.interaction.yield?.allowed !== true)
          throw createInvariantError(
            debateInvariantIds.yieldRequiresFloor,
            'The resolved rules forbid yielding',
          );
        if (rules.interaction.yield.returnsTime && rules.inRoundPrep !== null) {
          const side = rules.segments[open.sequence]!.side;
          const unused = open.startedAtMs + open.durationMs - now;
          if (unused > 0)
            on.setPrepConsumed(
              side,
              Math.max(0, on.checkpoint().prep_consumed_ms[side] - unused),
            );
        }
        closeRow(on, into, open, now);
        return;
      }
      case 'interrupt': {
        const open = on.openRow();
        const policy = rules.interaction.interruptions;
        if (
          open === undefined ||
          policy === null ||
          policy.allowed === 'disabled'
        )
          throw createInvariantError(
            debateInvariantIds.interruptRequiresPolicy,
            'The resolved rules forbid interruptions here',
          );
        if (policy.allowed === 'cross_ex_only' && open.type !== 'cross_ex')
          throw createInvariantError(
            debateInvariantIds.interruptRequiresPolicy,
            'Interruptions are confined to cross-examination',
          );
        const remaining = open.startedAtMs + open.durationMs - now;
        if (remaining < policy.minRemainingMs)
          throw createInvariantError(
            debateInvariantIds.interruptRequiresPolicy,
            'Too little of the segment remains to interrupt',
          );
        const seat = seatOf(actorId);
        if (seat === null)
          throw createAppError('CONFLICT', 'Interruptions come from a seat');
        const holder = floorHolderSeat(on);
        if (holder !== null && holder.id === seat.id)
          throw createInvariantError(
            debateInvariantIds.interruptRequiresPolicy,
            'The floor holder cannot interrupt themselves',
          );
        on.setFloor({ participantId: seat.id, grantedAtMs: now });
        return;
      }
      case 'forfeit': {
        const side = sideOf(actorId);
        if (side === null)
          throw createAppError('CONFLICT', 'A seated debater forfeits');
        const open = on.openRow();
        if (open !== undefined) closeRow(on, into, open, now);
        on.endPrep();
        const outcome = other(side);
        on.setLifecycle({
          status: 'completed',
          outcome,
          completedAtMs: now,
        });
        into.effects.push({
          kind: 'round_completed',
          outcome,
          at: iso(now),
        });
        return;
      }
      case 'complete': {
        const open = on.openRow();
        const last = rules.segments.length - 1;
        if (
          open === undefined ||
          open.sequence !== last ||
          now < open.startedAtMs + open.durationMs
        )
          throw createInvariantError(
            debateInvariantIds.completeAfterFinalSegment,
            'Completion follows the final segment’s time',
          );
        closeRow(on, into, open, now);
        on.endPrep();
        on.setLifecycle({
          status: 'completed',
          outcome: command.outcome,
          completedAtMs: now,
        });
        into.effects.push({
          kind: 'round_completed',
          outcome: command.outcome,
          at: iso(now),
        });
        return;
      }
    }
  };

  const stageOf = (on: RoundStore): RoundStage | null => {
    const status = on.lifecycle().status;
    if (status !== 'active') return null;
    if (on.openRow() !== undefined) return 'live';
    if (on.checkpoint().active_prep !== null) return 'prep';
    return 'countdown';
  };

  /** The full position of one store at `now`; pure over its input. */
  const positionOfStore = (on: RoundStore, now: number): RoundPosition => {
    const lifecycle = on.lifecycle();
    const checkpoint = on.checkpoint();
    const allRows = on.rows();
    const open = allRows.find((row) => row.endedAtMs === null);
    const spoken = allRows.filter((row) => row.endedAtMs !== null).length;
    const active = checkpoint.active_prep;
    const startable =
      lifecycle.status === 'scheduled' || lifecycle.status === 'active';
    const upcomingSegment = rules.segments[spoken];
    const upcoming =
      open === undefined &&
      startable &&
      spoken < rules.segments.length &&
      upcomingSegment
        ? {
            key: upcomingSegment.key,
            label: upcomingSegment.label,
            type: upcomingSegment.type,
            side: upcomingSegment.side,
            sequence: spoken,
          }
        : null;
    const inRoundPrep = rules.inRoundPrep;
    return {
      status: lifecycle.status,
      stage: stageOf(on),
      startedAt:
        lifecycle.startedAtMs === null ? null : iso(lifecycle.startedAtMs),
      completedAt:
        lifecycle.completedAtMs === null ? null : iso(lifecycle.completedAtMs),
      outcome: lifecycle.outcome,
      openSegment:
        open === undefined
          ? null
          : {
              key: open.key,
              label: rules.segments[open.sequence]!.label,
              type: open.type,
              side: rules.segments[open.sequence]!.side,
              sequence: open.sequence,
              startedAt: iso(open.startedAtMs),
              endsAt: iso(open.startedAtMs + open.durationMs),
              remainingMs: Math.max(
                0,
                open.startedAtMs + open.durationMs - now,
              ),
              floorParticipantId:
                checkpoint.floor?.holder_participant_id ?? null,
            },
      nextSegment: upcoming,
      countdownRemainingMs:
        lifecycle.status === 'active' &&
        open === undefined &&
        active === null &&
        upcoming !== null
          ? Math.max(
              0,
              (lifecycle.gapAnchorMs ?? now) + rules.countdownMs - now,
            )
          : null,
      prep:
        active === null
          ? null
          : {
              side: active.side,
              remainingMs: Math.max(
                0,
                (inRoundPrep?.budgetMsPerSide ?? 0) -
                  checkpoint.prep_consumed_ms[active.side] -
                  (now - Date.parse(active.started_at)),
              ),
            },
      prepBudgetRemainingMs:
        inRoundPrep === null
          ? null
          : {
              affirmative: Math.max(
                0,
                inRoundPrep.budgetMsPerSide -
                  checkpoint.prep_consumed_ms.affirmative,
              ),
              negative: Math.max(
                0,
                inRoundPrep.budgetMsPerSide -
                  checkpoint.prep_consumed_ms.negative,
              ),
            },
      awaitingBallot:
        lifecycle.status === 'active' &&
        open !== undefined &&
        open.sequence === rules.segments.length - 1 &&
        now >= open.startedAtMs + open.durationMs,
    };
  };

  const roundBlockOf = (on: RoundStore): RoundProjection['round'] => {
    const lifecycle = on.lifecycle();
    return {
      status: lifecycle.status,
      currentStage: stageOf(on),
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
