import type { FormatSettings } from './format-settings';
import type { RoomView, roomRefusalSchema } from './room-read';
export type { RoomView, RoomCatalogChoice, RoomCastChoice } from './room-read';
import { z } from 'zod';
import { debateRoleSchema, idSchema } from './primitives';
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
  competitionTypes,
  roundStageSchema,
  type CompetitionType,
} from './round';

export const roomStatuses = [
  'assembling',
  'ready',
  'started',
  'abandoned',
] as const;
/**
 * What a host may choose when creating or editing a Room. Private is refused
 * until an invite path can seat a second human (ISSUE-443, DEC-206).
 */
const roomVisibilitySchema = z.enum(['public', 'unlisted']);
const versionSchema = z.int().positive();
const textSchema = z.string().trim().min(1);
const seat = { role: debateRoleSchema, slot: z.int().min(0) };

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
  }),
]);
/**
 * A fixed-topic Room names its resolution; a draw Room's topic is null
 * until its reveal (FMT-7). A catalog or ranked selection's draw comes
 * from its preset, so creation checks that pairing after resolving it.
 */
export const roomCreateSchema = z
  .strictObject({
    commandId: idSchema,
    title: textSchema,
    topic: textSchema.nullable(),
    visibility: roomVisibilitySchema,
    selection: roomSelectionSchema,
  })
  .refine(
    (create) =>
      create.selection.kind !== 'custom' ||
      (create.topic === null) ===
        create.selection.config.resolutionDraw.enabled,
    {
      message: 'A draw room has no topic; any other room needs one',
      path: ['topic'],
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
  z.strictObject({ ...envelope, type: z.literal('claim-seat'), ...seat }),
  z.strictObject({
    ...envelope,
    type: z.literal('assign-seat'),
    actorId: idSchema,
    ...seat,
  }),
  z.strictObject({ ...envelope, type: z.literal('leave-seat') }),
  z.strictObject({
    ...envelope,
    type: z.literal('remove-seat'),
    participantId: idSchema,
  }),
  ...(['ready', 'unready'] as const).map((type) =>
    z.strictObject({
      ...envelope,
      type: z.literal(type),
      expectedConsentVersion: z.int().min(0),
    }),
  ),
  ...(['start-pre-round', 'finish-prep', 'start-round', 'close'] as const).map(
    (type) => z.strictObject({ ...envelope, type: z.literal(type) }),
  ),
  z.strictObject({
    ...envelope,
    type: z.literal('strike-resolution'),
    /** The strike this form means to make: a stale form conflicts. */
    ordinal: z.int().min(0),
    position: z.int().min(0),
  }),
]);
export type RoomCommand = z.infer<typeof roomCommandSchema>;
export type RoomCreate = z.infer<typeof roomCreateSchema>;

export type RoomParticipant = {
  readonly id: string;
  readonly actorId: string;
  readonly kind: 'human' | 'bot';
  readonly label: string;
  readonly consentVersion: number;
  readonly role: 'affirmative' | 'negative' | 'judge';
  readonly slot: number;
};
type RoomRoundRef = {
  readonly id: string;
  readonly status: 'scheduled' | 'active' | 'completed' | 'abandoned';
};
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
/** Portable assembly facts supplied by the durable adapter to pure operations. */
export type RoomAssemblyState = {
  readonly id: string;
  readonly version: number;
  readonly changeVersion: number;
  readonly title: string;
  /** Null exactly while a draw Room has not revealed its resolution. */
  readonly topic: string | null;
  readonly visibility: 'public' | 'unlisted' | 'private';
  readonly hostActorId: string;
  readonly hostLabel: string;
  readonly status: (typeof roomStatuses)[number];
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
  readonly competitionType: CompetitionType;
  readonly definition: FormatDefinition;
  readonly config: RoomConfig;
  readonly executionPlan: RoomExecutionPlan;
  readonly rules: RoundRules;
  readonly roundRef: RoomRoundRef | null;
  readonly participants: readonly (RoomParticipant & {
    readonly label: string;
    readonly eligible: boolean;
    readonly consentCommandId: string | null;
  })[];
  readonly prepStartedAt: string | null;
  readonly prepRemainingMs: number | null;
  /** The Room's one draw, once its pre-round has begun with one. */
  readonly resolutionDraw: ResolutionDrawState | null;
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
  /** A freeze that reserves the host's AI-round allowance (DEC-186). */
  readonly spendsAiRound: boolean;
  readonly publishDefinition: boolean;
  /** The seed and private inputs of a draw this mutation creates; never delivered. */
  readonly drawSecrets: {
    readonly seed: string;
    readonly inputs: DrawPrivateInputs;
  } | null;
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
});
/** Active discovery carries the catalog label, not cast, full rules/configuration or consent. */
const roomListEntrySchema = z.strictObject({
  id: idSchema,
  version: z.int().positive(),
  title: z.string().min(1),
  /** Null while a draw Room has not revealed its resolution. */
  topic: z.string().min(1).nullable(),
  visibility: z.enum(['public', 'unlisted', 'private']),
  /** Null when the host sits as a judge this viewer may not name (DEC-174). */
  hostActorId: idSchema.nullable(),
  hostLabel: z.string().nullable(),
  status: z.enum(['assembling', 'ready', 'started']),
  competitionType: z.enum(competitionTypes),
  seated: z.boolean(),
  roundRef: z
    .strictObject({ id: idSchema, status: z.enum(['scheduled', 'active']) })
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
  /** A ranked host's current-season Ranked rating; null otherwise or hidden. */
  hostRating: z.int().nullable(),
});
export const roomListPageSchema = z.strictObject({
  rooms: z.array(roomListEntrySchema).max(50).readonly(),
  nextCursor: idSchema.nullable(),
  retry: z.boolean(),
});
export type RoomListQuery = z.infer<typeof roomListQuerySchema>;
export type RoomListEntry = z.infer<typeof roomListEntrySchema>;
export type RoomListPage = z.infer<typeof roomListPageSchema>;
