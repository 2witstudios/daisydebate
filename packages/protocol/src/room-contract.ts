import { z } from 'zod';
import { debateRoleSchema, idSchema } from './primitives';
import { formatDefinitionSchema, roundRulesSchema } from './format';
import { roomConfigSchema, roomExecutionPlanSchema } from './room';
import { roundLengthSchema } from './round';

export const roomStatuses = [
  'assembling',
  'ready',
  'started',
  'abandoned',
] as const;
export const roomVisibilitySchema = z.enum(['public', 'unlisted', 'private']);
const versionSchema = z.int().positive();
const textSchema = z.string().trim().min(1);
const seat = { role: debateRoleSchema, slot: z.int().min(0) };

/** Custom schedules are compiler inputs, persisted as immutable format revisions. */
export const roomSelectionSchema = z.discriminatedUnion('kind', [
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
export type RoomSelection = z.infer<typeof roomSelectionSchema>;

export type RoomParticipant = {
  readonly id: string;
  readonly actorId: string;
  readonly kind: 'human' | 'bot';
  readonly label: string;
  readonly consentVersion: number;
  readonly role: 'affirmative' | 'negative' | 'judge';
  readonly slot: number;
};
export type RoomRoundRef = {
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
export type RoomView = {
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
  readonly length: 'full' | 'quick';
  readonly definition: z.infer<typeof formatDefinitionSchema>;
  readonly config: z.infer<typeof roomConfigSchema>;
  readonly executionPlan: z.infer<typeof roomExecutionPlanSchema>;
  readonly rules: z.infer<typeof roundRulesSchema>;
  readonly participants: readonly (RoomParticipant & {
    readonly needsReady: boolean;
    readonly ready: 'ready' | 'not-ready' | 'unavailable';
    readonly eligible: boolean;
  })[];
  readonly readiness: {
    readonly available: boolean;
    readonly version: number;
    readonly readyActorIds: readonly string[];
  };
  readonly prep: {
    readonly startedAt: string | null;
    readonly remainingMs: number | null;
    readonly finished: boolean;
  };
  readonly capabilities: {
    readonly host: boolean;
    readonly canEdit: boolean;
    readonly canClaimSeat: boolean;
    readonly canReady: boolean;
    readonly canStartPrep: boolean;
    readonly canFinishPrep: boolean;
    readonly canStart: boolean;
  };
  readonly startRefusal: RoomRefusal | null;
  readonly roundRef: RoomRoundRef | null;
};
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
export type RoomCatalogChoice = {
  readonly formatId: string;
  readonly formatVersion: number;
  readonly label: string;
  readonly definition: z.infer<typeof formatDefinitionSchema>;
  readonly defaultConfig: z.infer<typeof roomConfigSchema>;
  readonly presets: readonly {
    readonly version: number;
    readonly length: 'full' | 'quick';
    readonly config: z.infer<typeof roomConfigSchema>;
  }[];
};

/** Portable assembly facts supplied by the durable adapter to pure operations. */
export type RoomAssemblyState = Omit<
  RoomView,
  'participants' | 'readiness' | 'prep' | 'capabilities' | 'startRefusal'
> & {
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
export type RoomMutation = {
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
export type RoomCastChoice = {
  readonly actorId: string;
  readonly label: string;
  readonly kind: 'bot';
  readonly eligible: boolean;
};
