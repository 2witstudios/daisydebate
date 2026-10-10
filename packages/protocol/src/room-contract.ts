import type { RoomView } from './room-read';
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
import { roundLengthSchema, type RoundLength } from './round';

export const roomStatuses = [
  'assembling',
  'ready',
  'started',
  'abandoned',
] as const;
const roomVisibilitySchema = z.enum(['public', 'unlisted', 'private']);
const versionSchema = z.int().positive();
const textSchema = z.string().trim().min(1);
const seat = { role: debateRoleSchema, slot: z.int().min(0) };

/** Custom schedules are compiler inputs, persisted as immutable format revisions. */
const roomSelectionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('catalog'),
    formatId: textSchema,
    formatVersion: versionSchema,
    length: roundLengthSchema,
    competitionType: z.enum(['casual', 'practice']),
    config: roomConfigSchema,
  }),
  z.strictObject({
    kind: z.literal('ranked'),
    formatId: textSchema,
    formatVersion: versionSchema,
    presetVersion: versionSchema,
    length: roundLengthSchema,
  }),
  z.strictObject({
    kind: z.literal('custom'),
    definition: formatDefinitionSchema,
    length: roundLengthSchema,
    competitionType: z.enum(['casual', 'practice']),
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
export type RoomRefusal =
  | 'version-conflict'
  | 'host-required'
  | 'room-closed'
  | 'illegal-config'
  | 'seat-unavailable'
  | 'actor-ineligible'
  | 'not-seated'
  | 'incomplete-cast'
  | 'not-ready'
  | 'readiness-unavailable'
  | 'prep-running'
  | 'prep-unavailable'
  | 'command-conflict'
  | 'consent-conflict';
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
  readonly competitionType: 'casual' | 'practice' | 'ranked';
  readonly length: RoundLength;
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
  readonly publishDefinition: boolean;
};
export type RoomMutationOutcome =
  | { readonly ok: true; readonly mutation: RoomMutation }
  | { readonly ok: false; readonly refusal: RoomRefusal };

/** Provisional discovery resource-work settings; these are not Room capacity. */
export const roomListQuerySchema = z.strictObject({
  cursor: idSchema.optional(),
  pageSize: z.int().min(1).max(50).default(20),
  q: z.string().max(100).default(''),
});
/** Active discovery deliberately omits cast, format/configuration and consent. */
const roomListEntrySchema = z.strictObject({
  id: idSchema,
  version: z.int().positive(),
  title: z.string().min(1),
  topic: z.string().min(1),
  visibility: z.enum(['public', 'unlisted', 'private']),
  hostActorId: idSchema,
  hostLabel: z.string(),
  status: z.enum(['assembling', 'ready', 'started']),
  competitionType: z.enum(['casual', 'practice', 'ranked']),
  length: z.enum(['full', 'quick']),
  seated: z.boolean(),
  roundRef: z
    .strictObject({ id: idSchema, status: z.enum(['scheduled', 'active']) })
    .nullable(),
});
export const roomListPageSchema = z.strictObject({
  rooms: z.array(roomListEntrySchema).max(50).readonly(),
  nextCursor: idSchema.nullable(),
  retry: z.boolean(),
});
export type RoomListQuery = z.infer<typeof roomListQuerySchema>;
export type RoomListEntry = z.infer<typeof roomListEntrySchema>;
export type RoomListPage = z.infer<typeof roomListPageSchema>;
