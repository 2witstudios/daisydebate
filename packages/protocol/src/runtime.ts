import type { ResolutionDrawState } from './resolution-draw';
import type { RoundOutcome } from './round-outcome';
import type { SeatRef, SideKey } from './seats';
import type { SpeakRights } from './format-seating';
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
  readonly seat: SeatRef;
  /** Whether a person or a bot holds the seat; some rules differ (INTX-17). */
  readonly kind: 'human' | 'bot';
};

/** A floor command and the segment it means (INTX-7). */
type FloorCommand<Type extends string> = {
  readonly type: Type;
  readonly sequence: number;
};

export type RoundCommand =
  /** Call prep for the segment named, now or when the one before it ends. */
  | FloorCommand<'start_prep'>
  /** Take back a prep called during the previous segment. */
  | FloorCommand<'cancel_prep'>
  /** End running prep: the named segment opens one microphone lead later. */
  | FloorCommand<'start_speech'>
  /** The scheduled seat ends its own speech or cross-examination early. */
  | FloorCommand<'yield'>
  /** Stand to offer a point of information in the named speech. */
  | FloorCommand<'offer_poi'>
  | FloorCommand<'withdraw_poi'>
  /** The speaker takes this seat's standing offer. */
  | (FloorCommand<'accept_poi'> & { readonly offererParticipantId: string })
  /** The speaker declines every standing offer. */
  | FloorCommand<'decline_poi'>
  /** The holder or the speaker gives the speech back before the point's limit. */
  | FloorCommand<'end_poi'>
  | { readonly type: 'forfeit' }
  /** A competitor leaves a Round no forfeit ends: absent, and the Round goes on (TAB-6.8). */
  | { readonly type: 'leave' };

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
type SegmentReturn = {
  readonly id: string;
  readonly returnedMs: number;
};

/** What a command or a tick did, for outbox fan-out and AI wake. */
export type RoundEffect =
  | { readonly kind: 'round_started'; readonly at: string }
  | {
      readonly kind: 'segment_opened';
      readonly key: string;
      /** The seat the segment is scheduled to; null for an open floor. */
      readonly lead: SeatRef | null;
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
      readonly side: SideKey;
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
  /** The actors whose seats left this revision, whom the Room holds no longer (TAB-6.8). */
  readonly releasesMembers?: readonly string[];
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
    /** The seat the segment is scheduled to; null for an open floor. */
    readonly lead: SeatRef | null;
    readonly speak: SpeakRights;
    readonly sequence: number;
    readonly startedAt: string;
    readonly endsAt: string;
    readonly remainingMs: number;
  } | null;
  readonly nextSegment: {
    readonly key: string;
    readonly label: string;
    readonly type: SegmentType;
    readonly lead: SeatRef | null;
    readonly speak: SpeakRights;
    readonly sequence: number;
  } | null;
  readonly countdownRemainingMs: number | null;
  /** Prep called for the next segment, or running now; null when neither. */
  readonly prep:
    | { readonly phase: 'called'; readonly side: SideKey }
    | {
        readonly phase: 'running';
        readonly side: SideKey;
        readonly remainingMs: number;
      }
    | null;
  /** The open speech's points of information; null when it takes none. */
  readonly pointOfInformation: PointOfInformationPosition | null;
  /** Remaining budget per side key; null when the format has no in-round prep. */
  readonly prepBudgetRemainingMs: Readonly<Record<SideKey, number>> | null;
  /** The budget died at its expiry segment: no prep is spendable from the coming segment on. */
  readonly prepExpired: boolean;
  /** A platform incident's hold on the clock, for every viewer alike. */
  readonly incident: RoundIncident;
};

/** Where a speech's points of information stand at one instant (INTX-13..15). */
export type PointOfInformationPosition = {
  /** When the protected start ends and offers open. */
  readonly offersOpenAt: string;
  /** When the protected end begins: no offer or acceptance after it. */
  readonly offersCloseAt: string;
  /** Standing offers, oldest first. */
  readonly offers: readonly {
    readonly participantId: string;
    readonly lapsesAt: string;
  }[];
  /** The accepted point being given, if any. */
  readonly holder: {
    readonly participantId: string;
    readonly endsAt: string;
    readonly remainingMs: number;
  } | null;
};

/** Conversation microphones may open: before the first segment or awaiting a ballot. */
export const conversational = (
  position: Pick<RoundPosition, 'stage' | 'openSegment' | 'nextSegment'>,
) =>
  position.stage === 'awaiting_ballot' ||
  (position.openSegment === null && position.nextSegment?.sequence === 0);
