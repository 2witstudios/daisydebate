import type { FormatSettings } from './format-settings';
import type { RoomView, roomRefusalSchema } from './room-read';
export type { RoomView, RoomCatalogChoice, RoomCastChoice } from './room-read';
import { z } from 'zod';
import { idSchema } from './primitives';
import { ratingDivisions, type RatingDivision } from './ladder';
import {
  seatRefSchema,
  type SeatKind,
  type SeatRef,
  type TwoSideKey,
} from './seats';
import { seatsOfKind, type FormatSeating } from './format-seating';
import { roomTeamSchema, teamSideSchema, type SeatDraw } from './seat-draw';
import {
  formatDefinitionSchema,
  type FormatDefinition,
  type RoundRules,
} from './format';
import {
  roomConfigSchema,
  type RoomConfig,
  type RoomExecutionPlan,
} from './room';
import type { DrawPrivateInputs, ResolutionDrawState } from './resolution-draw';
import {
  recordingPolicySchema,
  roomCaptureSchema,
  type RoomCapture,
} from './room-capture';
import { roomResolutionSelectionSchema } from './room-resolution';
import {
  competitionTypes,
  roundStageSchema,
  runningRoundStatuses,
  type CompetitionType,
  type RoundStatus,
} from './round';

export const roomStatuses = [
  'assembling',
  'ready',
  'started',
  'closed',
] as const;
export type RoomStatus = (typeof roomStatuses)[number];
/**
 * What a host may choose when creating or editing a Room. Private is refused
 * until an invite path can seat a second human (ISSUE-443, DEC-206).
 */
const roomVisibilitySchema = z.enum(['public', 'unlisted']);
const versionSchema = z.int().positive();
const textSchema = z.string().trim().min(1);
const seat = { seat: seatRefSchema };

/** Custom schedules are compiler inputs, persisted as immutable format revisions. */
const roomSelectionSchema = z.discriminatedUnion('kind', [
  /** A catalog format at its canonical preset; the server reads the config (FMT-1). */
  z.strictObject({
    kind: z.literal('catalog'),
    formatId: textSchema,
    formatVersion: versionSchema,
    presetVersion: versionSchema,
    competitionType: z.literal('casual'),
  }),
  z.strictObject({
    kind: z.literal('ranked'),
    formatId: textSchema,
    formatVersion: versionSchema,
    presetVersion: versionSchema,
  }),
  z.strictObject({
    kind: z.literal('custom'),
    definition: formatDefinitionSchema,
    competitionType: z.literal('casual'),
    config: roomConfigSchema,
    basis: z
      .strictObject({
        formatId: textSchema,
        formatVersion: versionSchema,
        presetVersion: versionSchema,
      })
      .nullable()
      .optional(),
  }),
]);
/**
 * The seat requests a create applies as its initial cast, before anyone
 * joins: the same assign-seat authority judges each one, so a refused cast
 * refuses the whole create.
 */
const castSeat = z.strictObject({ actorId: idSchema, ...seat });
/**
 * A fixed-topic Room names its resolution; a draw Room's topic is null
 * until its reveal (FMT-7). A catalog or ranked selection's draw comes
 * from its preset, so creation checks that pairing after resolving it.
 */
export const roomCreateSchema = z
  .strictObject({
    commandId: idSchema,
    title: textSchema,
    resolution: roomResolutionSelectionSchema,
    visibility: roomVisibilitySchema,
    selection: roomSelectionSchema,
    /** Casual hosts may choose who sees the Recording; ranked capture is automatic. */
    recordingPolicy: recordingPolicySchema.optional(),
    /** A casual host may keep the call open after the Round (ADR 0127). */
    postRoundCall: z.boolean().optional(),
    /** Each actor at most once: assign-seat would move, not reject, a repeat. */
    cast: z
      .array(castSeat)
      .max(8)
      .refine(
        (cast) =>
          new Set(cast.map((seat) => seat.actorId)).size === cast.length,
        { message: 'A cast seats an actor at most once', path: ['cast'] },
      )
      .optional(),
    /** Named members whose debater seats nobody else may take for a short while. */
    holdSeatsFor: z
      .array(idSchema)
      .max(2)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: 'A hold names an actor at most once',
      })
      .optional(),
    /**
     * Whether the sides are open (decided by a coin flip at Start round) or
     * fixed to the cast's placements (ADR 0145). Omitted: open, unless the
     * cast names a debater, whose producer chose the sides (Tab, DEC 4909).
     * A ranked Room's sides are always open.
     */
    sides: z.enum(['open', 'fixed']).optional(),
    /**
     * A Train practice (decision 75): its creator is held as an active
     * member from create, seated or not, so a second Start practice returns
     * to this Room. Any other Room holds only its seated people (TAB-6.16).
     */
    practice: z.literal(true).optional(),
    /** The capture notice the create form showed its host, to be recorded; only a casual create with capture states one. */
    noticeVersion: z.string().min(1).max(64).optional(),
    /**
     * The lobby the Room opens in (ADR 0156). Omitted: the creator's own.
     * Only club staff may name Youth from the Open lobby; any other lobby
     * not the creator's own is refused `other-division`.
     */
    lobby: z.enum(ratingDivisions).optional(),
  })
  .refine(
    (create) =>
      create.selection.kind !== 'custom' ||
      (create.resolution.kind === 'strike') ===
        create.selection.config.resolutionDraw.enabled,
    {
      message: 'A draw room has no topic; any other room needs one',
      path: ['resolution'],
    },
  )
  .refine(
    (create) =>
      create.selection.kind !== 'ranked' || create.visibility === 'public',
    { message: 'A ranked Room is always public', path: ['visibility'] },
  )
  .refine(
    (create) =>
      create.selection.kind !== 'ranked' ||
      create.recordingPolicy === undefined,
    { message: 'Ranked recording is automatic', path: ['recordingPolicy'] },
  )
  .refine(
    (create) =>
      create.selection.kind !== 'ranked' || create.postRoundCall !== true,
    {
      message: 'A ranked Round has no post-round call',
      path: ['postRoundCall'],
    },
  );

const envelope = { commandId: idSchema, expectedVersion: versionSchema };
export const roomCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...envelope,
    type: z.literal('update-config'),
    config: roomConfigSchema,
    /** Required exactly when the change turns a draw on (null) or off (text). */
    topic: textSchema.nullable().optional(),
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('update-details'),
    title: textSchema,
    /** Fixed-topic Rooms only: a draw Room's topic comes from its reveal. */
    topic: textSchema.optional(),
    visibility: roomVisibilitySchema,
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('update-format'),
    definition: formatDefinitionSchema,
    config: roomConfigSchema,
    topic: textSchema.nullable().optional(),
  }),
  /**
   * Choose a catalog format at its canonical preset, or reset to the room's
   * pinned basis (FMT-1). The server decides through the one selection
   * policy. Choosing is itself the act, so `topic` is required exactly when
   * the choice leaves a draw: entering a draw clears the topic (FMT-2b).
   */
  z.strictObject({
    ...envelope,
    type: z.literal('select-format'),
    intent: z.enum(['choose', 'reset']),
    formatId: textSchema,
    formatVersion: versionSchema,
    presetVersion: versionSchema,
    topic: textSchema.optional(),
  }),
  /** The host's capture choice; nothing chosen clears it (WATCH-8). */
  z.strictObject({
    ...envelope,
    type: z.literal('set-capture'),
    capture: roomCaptureSchema,
  }),
  z.strictObject({ ...envelope, type: z.literal('claim-seat'), ...seat }),
  z.strictObject({
    ...envelope,
    type: z.literal('assign-seat'),
    actorId: idSchema,
    ...seat,
  }),
  z.strictObject({ ...envelope, type: z.literal('leave-seat') }),
  /**
   * Move one debater (ADR 0145): to a team (null = ?, placed at random at
   * Start round) and a speaking position within it (null = ?). A member
   * moves themselves; the host moves anyone.
   */
  z.strictObject({
    ...envelope,
    type: z.literal('set-seat'),
    participantId: idSchema,
    team: roomTeamSchema.nullable(),
    position: z.int().min(0).nullable(),
  }),
  /**
   * Team 1's side; team 2 argues the other. Null opens both to a coin flip
   * at Start round. A debater sets their own team's, the host either.
   */
  z.strictObject({
    ...envelope,
    type: z.literal('set-sides'),
    teamOneSide: teamSideSchema.nullable(),
  }),
  /** Who can join, alone, from the page's Room controls (ADR 0145, D9). */
  z.strictObject({
    ...envelope,
    type: z.literal('set-visibility'),
    visibility: roomVisibilitySchema,
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('remove-seat'),
    participantId: idSchema,
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('ready'),
    expectedConsentVersion: z.int().min(0),
    /** The capture notice this form showed; absent when it showed none. */
    noticeVersion: z.string().min(1).max(64).optional(),
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('unready'),
    expectedConsentVersion: z.int().min(0),
  }),
  ...(['start-round', 'close'] as const).map((type) =>
    z.strictObject({ ...envelope, type: z.literal(type) }),
  ),
]);
export type RoomCommand = z.infer<typeof roomCommandSchema>;
export type RoomCreate = z.infer<typeof roomCreateSchema>;

export type RoomParticipant = {
  readonly id: string;
  readonly actorId: string;
  readonly kind: 'human' | 'bot';
  readonly label: string;
  readonly consentVersion: number;
  readonly seat: SeatRef;
  /** A debater whose team is ?: placed on a team at random at Start round (ADR 0145). */
  readonly teamOpen: boolean;
  /** A debater whose position is ?: given a speaking position at random at Start round. */
  readonly positionOpen: boolean;
};
type RoomRoundRef = {
  readonly id: string;
  readonly status: RoundStatus;
};
/**
 * A Room and the Round it launched, as one state: an open Room has launched
 * none, a started Room always names its Round, and a closed Room may have
 * closed either way. The stored and sent shape is unchanged.
 */
export type RoomRoundLink =
  | { readonly status: OpenRoomStatus; readonly roundRef: null }
  | { readonly status: 'started'; readonly roundRef: RoomRoundRef }
  | { readonly status: 'closed'; readonly roundRef: RoomRoundRef | null };
/**
 * A stored Room status and the Round row found for it, as the one state they
 * mean. Start round writes both in one transaction, so they always agree; the
 * Round row is the fact if they ever do not. A Room with a Round has started,
 * and a started Room with no Round can launch nothing and reads as closed. So
 * no read fails on a row, and no reader is offered a seat or a Round that is
 * not there.
 */
export const roomRoundLinkOf = (
  status: RoomStatus,
  roundRef: RoomRoundRef | null,
): RoomRoundLink => {
  if (status === 'closed') return { status, roundRef };
  return roundRef === null
    ? { status: status === 'started' ? 'closed' : status, roundRef }
    : { status: 'started', roundRef };
};
/** Whether a Room's status and its Round reference are a pair a Room can hold. */
export const isRoomRoundLink = <
  T extends {
    readonly status: RoomStatus;
    readonly roundRef: RoomRoundRef | null;
  },
>(
  room: T,
): room is T & RoomRoundLink =>
  room.status === 'closed' ||
  (room.status === 'started') === (room.roundRef !== null);
export type RoomRefusal = z.infer<typeof roomRefusalSchema>;
/** Receipts acknowledge an accepted command; effective consent always comes from a fresh view. */
export type RoomCommandReceipt = {
  readonly commandId: string;
  readonly roomId: string;
  readonly resultingVersion: number;
  readonly roundRef: RoomRoundRef | null;
  readonly replayed: boolean;
};
export type RoomCommandResponse = {
  readonly receipt: RoomCommandReceipt;
  readonly view: RoomView;
};
/** How long a seat stays held for a named member who has not arrived (ADR 0103). */
export const ROOM_SEAT_HOLD_MS = 120_000;

/**
 * A Room still gathering its players (ADR 0070): the only Rooms a challenge
 * or an invitation may point at.
 */
export const openRoomStatuses = [
  'assembling',
  'ready',
] as const satisfies readonly RoomStatus[];
export type OpenRoomStatus = (typeof openRoomStatuses)[number];
/** Whether a Room in `status` is still open. */
export const isOpenRoomStatus = (
  status: RoomStatus,
): status is OpenRoomStatus =>
  (openRoomStatuses as readonly RoomStatus[]).includes(status);
/** Whether a Room is still open, narrowing it to what an open Room holds. */
export const isOpenRoom = <T extends { readonly status: RoomStatus }>(
  room: T,
): room is T & { readonly status: OpenRoomStatus } =>
  isOpenRoomStatus(room.status);
/**
 * How many seats of a kind are free: the kind's seats the rules declare
 * (every side's, for a side seat), less those taken (other than
 * `exceptActorId`'s own). The engine and the Room page count the same way
 * (ADR 0124).
 */
export const freeSeatsOf = (
  room: {
    readonly rules: FormatSeating;
    readonly participants: readonly {
      readonly seat: SeatRef;
      readonly actorId?: string;
    }[];
  },
  kind: SeatKind,
  exceptActorId?: string,
): number =>
  seatsOfKind(room.rules, kind) -
  room.participants.filter(
    (p) =>
      p.seat.kind === kind &&
      (exceptActorId === undefined || p.actorId !== exceptActorId),
  ).length;

/**
 * A seat of one kind kept for a named member until `until`: a challenge's
 * arrival (ADR 0103) or a pending invitation (ADR 0124).
 */
type RoomSeatHold = {
  readonly actorId: string;
  readonly seat: SeatKind;
  readonly until: string;
};

/** Portable assembly facts supplied by the durable adapter to pure operations. */
export type RoomAssemblyState = RoomRoundLink & {
  readonly id: string;
  readonly version: number;
  readonly changeVersion: number;
  readonly title: string;
  /** Null exactly for a draw Room: its resolution belongs to the Round. */
  readonly topic: string | null;
  readonly visibility: 'public' | 'unlisted' | 'private';
  /** Null for a Room no person hosts: host-only commands are refused for it. */
  readonly hostActorId: string | null;
  /** The host took over from a restricted one, and names no human judge (DEC-331). */
  readonly hostInherited: boolean;
  readonly hostLabel: string;
  readonly formatId: string;
  readonly formatVersion: number;
  readonly presetVersion: number | null;
  /** The running format's display facts; a custom format has no role and no leagues. */
  readonly catalogFormat: {
    readonly name: string;
    readonly role: 'standard' | 'template' | null;
    readonly leagues: readonly string[];
  };
  /**
   * The catalog preset a casual room is based on (FMT-1), hydrated with what
   * standing compares against; null for ranked and custom rooms.
   */
  readonly basis: {
    readonly formatId: string;
    readonly presetVersion: number;
    readonly formatVersion: number;
    readonly name: string;
    readonly role: 'standard' | 'template';
    readonly definition: FormatDefinition;
    /** The basis preset's format settings, not a Room config (ISSUE-775). */
    readonly config: FormatSettings;
  } | null;
  readonly seatHolds: readonly RoomSeatHold[];
  /** Team 1's side, or null while the sides are open to the coin flip (ADR 0145). */
  readonly teamOneSide: TwoSideKey | null;
  /**
   * The Room holds its host as an active member, seated or not: a Train
   * practice (decision 75). Absent or false: only its seated people.
   */
  readonly holdsHost?: boolean;
  readonly competitionType: CompetitionType;
  /**
   * The lobby the Room was created in, fixed for its life (ADR 0156): its
   * debater seats are for that division's members.
   */
  readonly division: RatingDivision;
  readonly definition: FormatDefinition;
  readonly config: RoomConfig;
  /** The casual host's capture choice; null when nothing is chosen, and always on ranked. */
  readonly capture: RoomCapture | null;
  /** The casual host keeps the call open after the Round (ADR 0127); never on ranked. */
  readonly postRoundCall: boolean;
  readonly executionPlan: RoomExecutionPlan;
  readonly rules: RoundRules;
  readonly participants: readonly (RoomParticipant & {
    readonly label: string;
    readonly eligible: boolean;
    readonly consentCommandId: string | null;
  })[];
};
export type RoomConsent = {
  readonly available: boolean;
  readonly readyActorIds: readonly string[];
};
type RoomMutation = {
  readonly state: RoomAssemblyState;
  readonly consent: {
    readonly type: 'ready' | 'unready';
    readonly actorId: string;
    readonly commandId: string;
  } | null;
  readonly freeze: boolean;
  /** Bot-debater admission/allowance (ADR 0117) and capacity (ADR 0058); a judge has separate usage accounting. */
  readonly seatsBotDebater: boolean;
  readonly publishDefinition: boolean;
  /** The draw a Start round creates with its Round, secrets never delivered. */
  readonly draw: {
    readonly state: ResolutionDrawState;
    readonly seed: string;
    readonly inputs: DrawPrivateInputs;
  } | null;
  /** What a Start round's seat draw did, frozen on its Round (ADR 0145). */
  readonly seatDraw: SeatDraw | null;
  /** The Round's secret seed (hex), stored with it and never delivered; null off Start round. */
  readonly roundSeed: string | null;
  /** The human actors the next state holds as active members (ADR 0070). */
  readonly members: readonly string[];
};
export type RoomMutationOutcome =
  | { readonly ok: true; readonly mutation: RoomMutation }
  | { readonly ok: false; readonly refusal: RoomRefusal };

/** The discovery statuses a listing can be narrowed to. */
export const roomListStatuses = ['open', 'starting', 'live'] as const;
export type RoomListStatus = (typeof roomListStatuses)[number];

/** The page size a listing query takes when it names none. */
export const roomListDefaultPageSize = 20;

/** The Lobby's orders over immutable creation time; the first is the default. */
export const roomListSorts = ['newest', 'longest-waiting'] as const;

/** Provisional discovery resource-work settings; these are not Room capacity. */
export const roomListQuerySchema = z.strictObject({
  cursor: idSchema.optional(),
  /** Immutable creation-time order; the Room id breaks timestamp ties. */
  sort: z.enum(roomListSorts).optional(),
  pageSize: z.int().min(1).max(50).default(roomListDefaultPageSize),
  q: z.string().trim().max(100).default(''),
  /**
   * The canonical Lobby filters, applied in the database before paging.
   * Omitted narrows nothing: there is no `all` or `any` value, so a
   * client's every-status or any-mode choice omits the key. `status` is
   * where a listed Room stands: open (assembling), starting (ready) or live.
   */
  status: z.enum(roomListStatuses).optional(),
  mode: z.enum(competitionTypes).optional(),
  /**
   * The lobby (ADR 0156): Rooms created in this division, casual and ranked.
   * The Lobby page always names one; omitted lists both.
   */
  division: z.enum(ratingDivisions).optional(),
});
/** Active discovery carries the catalog label, not cast, full rules/configuration or consent. */
const roomListEntryFields = z.strictObject({
  id: idSchema,
  version: z.int().positive(),
  title: z.string().min(1),
  /** Null until a draw's reveal; a live Round's resolution once it has one. */
  topic: z.string().min(1).nullable(),
  visibility: z.enum(['public', 'unlisted', 'private']),
  /** Null when the host sits as a judge this viewer may not name (DEC-174). */
  hostActorId: idSchema.nullable(),
  hostLabel: z.string().nullable(),
  status: z.enum(['assembling', 'ready', 'started']),
  competitionType: z.enum(competitionTypes),
  seated: z.boolean(),
  roundRef: z
    .strictObject({ id: idSchema, status: z.enum(runningRoundStatuses) })
    .nullable(),
  /** The joined catalog format's stored name. */
  formatLabel: z.string().min(1),
  /** Seats filled, of every seat the Room's rules declare. */
  seatsTaken: z.int().nonnegative(),
  seatCount: z.int().positive(),
  /** When an open Room started waiting for its cast; null once launched. */
  waitingSince: z.iso.datetime({ offset: true }).nullable(),
  /** A live Round's stage and start; null until launched. */
  live: z
    .strictObject({
      stage: roundStageSchema.nullable(),
      startedAt: z.iso.datetime({ offset: true }).nullable(),
    })
    .nullable(),
  /**
   * A ranked host's current-season rating on this Room's ladder; null
   * otherwise, while no ladder is set, or hidden.
   */
  hostRating: z.int().nullable(),
  /** The lobby the Room was created in (ADR 0156). */
  division: z.enum(ratingDivisions),
  /** Free judge seats: anyone may judge, whatever the lobby. */
  openJudgeSeats: z.int().nonnegative(),
});
/** A listed Room is open and waiting, or started with its Round and that Round's live facts. */
const roomListEntrySchema = roomListEntryFields.refine(
  (entry) =>
    entry.status === 'started'
      ? entry.roundRef !== null &&
        entry.live !== null &&
        entry.waitingSince === null
      : entry.roundRef === null &&
        entry.live === null &&
        entry.waitingSince !== null,
  {
    message:
      'A listed Room names its Round and live facts exactly once it has started',
    path: ['roundRef'],
  },
);
export const roomListPageSchema = z.strictObject({
  rooms: z.array(roomListEntrySchema).max(50).readonly(),
  nextCursor: idSchema.nullable(),
  retry: z.boolean(),
});
export type RoomListQuery = z.infer<typeof roomListQuerySchema>;
export type RoomListEntry = z.infer<typeof roomListEntrySchema>;
export type RoomListPage = z.infer<typeof roomListPageSchema>;
