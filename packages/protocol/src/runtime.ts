import type { DebateRole, DebateSide } from './primitives';
import type { RatedOutcome } from './ratings';
import type { SegmentType } from './format';
import type { RoundStage, RoundStatus, RuntimeCheckpoint } from './round';
import { z } from 'zod';

/**
 * The round runtime contract (ADR 0058 §4) between `@daisy/db`, which
 * hydrates and projects, `@daisy/debate-engine`, which executes, and the
 * web client, which derives the same position. Types only: execution and
 * storage stay in their owning packages.
 */

/** The hydrated round row the runtime starts from. */
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

export const roundCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('start') }),
  z.strictObject({ type: z.literal('start_prep') }),
  z.strictObject({ type: z.literal('start_speech') }),
  z.strictObject({ type: z.literal('yield') }),
  z.strictObject({ type: z.literal('interrupt') }),
  z.strictObject({ type: z.literal('forfeit') }),
  z.strictObject({
    type: z.literal('complete'),
    outcome: z.enum(['affirmative', 'negative', 'draw']),
  }),
]);
export type RoundCommand = z.infer<typeof roundCommandSchema>;

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
