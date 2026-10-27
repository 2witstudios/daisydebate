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
  z.strictObject({
    kind: z.literal('catalog'),
    formatId: textSchema,
    formatVersion: versionSchema,
    competitionType: z.literal('casual'),
    config: roomConfigSchema,
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
export const roomCreateSchema = z.strictObject({
  commandId: idSchema,
  title: textSchema,
  topic: textSchema,
  visibility: roomVisibilitySchema,
  selection: roomSelectionSchema,
});

const envelope = { commandId: idSchema, expectedVersion: versionSchema };
export const roomCommandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...envelope,
    type: z.literal('update-config'),
    config: roomConfigSchema,
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('update-details'),
    title: textSchema,
    topic: textSchema,
    visibility: roomVisibilitySchema,
  }),
  z.strictObject({
    ...envelope,
    type: z.literal('update-format'),
    definition: formatDefinitionSchema,
    config: roomConfigSchema,
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
  ...(['start-prep', 'finish-prep', 'start-round', 'close'] as const).map(
    (type) => z.strictObject({ ...envelope, type: z.literal(type) }),
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
  readonly topic: string;
  readonly visibility: 'public' | 'unlisted' | 'private';
  readonly hostActorId: string;
  readonly hostLabel: string;
  readonly status: (typeof roomStatuses)[number];
  readonly formatId: string;
  readonly formatVersion: number;
  readonly presetVersion: number | null;
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

/** Provisional discovery resource-work settings; these are not Room capacity. */
export const roomListQuerySchema = z.strictObject({
  cursor: idSchema.optional(),
  /** Immutable creation-time order; the Room id breaks timestamp ties. */
  sort: z.enum(['longest-waiting', 'newest']).optional(),
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
  topic: z.string().min(1),
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
