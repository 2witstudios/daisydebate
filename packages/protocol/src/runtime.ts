import type { ResolutionDrawState } from './resolution-draw';
import type { DebateRole, DebateSide, RoundOutcome } from './primitives';
import type { RoundLifecycle } from './round-lifecycle';
import type { SegmentType } from './format';
import type {
  PlatformIncidentCause,
  RoundIncident,
  RoundStage,
  RuntimeCheckpoint,
} from './round';

/**
 * The round runtime contract (ADR 0058 §4) between `@daisy/db`, which
 * hydrates and projects, `@daisy/debate-engine`, which executes, and the
 * web client, which derives the same position. Types only: execution and
 * storage stay in their owning packages.
 */

/** The hydrated round row the runtime starts from: one lifecycle, never a mix of two. */
export type HydratedRound = RoundLifecycle & {
  readonly id: string;
  readonly currentStage: RoundStage | null;
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
  /** Airtime a platform incident gave back; the duration stays the rule's. */
  readonly returnedMs: number;
};

/** One `round_participants` row, hydrated. */
export type RoundParticipantSeat = {
  readonly id: string;
  readonly actorId: string;
  readonly role: DebateRole;
  readonly slot: number;
};

export type RoundCommand =
  | { readonly type: 'start_prep' }
  | { readonly type: 'start_speech' }
  | { readonly type: 'yield' }
  | { readonly type: 'interrupt' }
  | { readonly type: 'forfeit' };

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

/** A speech's new total of returned airtime, for the caller to write onto its row. */
export type SegmentReturn = {
  readonly id: string;
  readonly returnedMs: number;
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
      readonly outcome: RoundOutcome | null;
      readonly at: string;
    };

/** Accepted speaking grants use half-open intervals and never name a judge. */
export type RoundSpeakingChange =
  | { readonly kind: 'close'; readonly segmentId: string; readonly at: string }
  | {
      readonly kind: 'open';
      readonly segmentId: string;
      readonly at: string;
      readonly participantIds: readonly string[];
    };

/** What happened to a platform incident in this revision; its row only records this. */
export type RoundIncidentChange =
  | {
      readonly kind: 'opened';
      readonly id: string;
      readonly since: string;
      readonly cause: PlatformIncidentCause;
      readonly resumePoint: string | null;
    }
  | {
      readonly kind: 'resumed';
      readonly at: string;
      readonly returnedMs: number;
    }
  | { readonly kind: 'ended'; readonly at: string };

/** The durable writes that materialize the runtime's state. */
export type RoundProjection = {
  /** Exact finalizer inputs, never reselected later from mutable ballot state. */
  readonly finalization?: {
    readonly freezeRevision: number;
    readonly ballotIds: readonly string[];
  };
  /** Actual final segment close, independent of ballot completion. */
  readonly finalSegmentEndedAt?: string;
  /** The engine's ruling that this Round holds its Room's members no longer (ADR 0070). */
  readonly releasesRoomMembers?: true;
  readonly speakingChanges?: readonly RoundSpeakingChange[];
  /** The opening's draw after this revision; the writer appends its new strikes. */
  readonly openingDraw?: ResolutionDrawState;
  /** The opening ended here: the Round's start, never the processing time. */
  readonly opensAt?: string;
  /** Null when no round-row column changed. */
  readonly round:
    | (RoundLifecycle & {
        readonly currentStage: RoundStage | null;
        readonly checkpoint: RuntimeCheckpoint;
      })
    | null;
  readonly segmentInserts: readonly SegmentInsert[];
  readonly segmentCloses: readonly SegmentClose[];
  readonly segmentReturns?: readonly SegmentReturn[];
  readonly incidentChanges?: readonly RoundIncidentChange[];
  readonly effects: readonly RoundEffect[];
};

/** The derived position at one instant: what UI and orchestration read. */
export type RoundPosition = RoundLifecycle & {
  readonly stage: RoundStage | null;
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
  /** A platform incident's hold on the clock, for every viewer alike. */
  readonly incident: RoundIncident;
};

/** Conversation microphones may open: before the first segment or awaiting a ballot. */
export const conversational = (
  position: Pick<RoundPosition, 'stage' | 'openSegment' | 'nextSegment'>,
) =>
  position.stage === 'awaiting_ballot' ||
  (position.openSegment === null && position.nextSegment?.sequence === 0);
