import { z } from 'zod';
import { idSchema, debateRoleSchema } from './primitives';
import { formatDefinitionSchema, roundRulesSchema } from './format';
import { formatSettingsSchema } from './format-settings';
import { frozenRoomConfigSchema, frozenRoomExecutionPlanSchema } from './room';
import { resolutionDrawViewSchema } from './resolution-draw';
import { competitionTypes, roundStatusSchema } from './round';
import { formatStandingSchema } from './format-standing';
const version = z.int().positive();
const visibility = z.enum(['public', 'unlisted', 'private']);
const nullableTimestamp = z.iso.datetime({ offset: true }).nullable();
const participant = z.strictObject({
  id: idSchema,
  actorId: idSchema,
  kind: z.enum(['human', 'bot']),
  label: z.string(),
  consentVersion: z.int().nonnegative(),
  role: debateRoleSchema,
  slot: z.int().nonnegative(),
});
const seatState = {
  needsReady: z.boolean(),
  ready: z.enum(['ready', 'not-ready', 'unavailable']),
  eligible: z.boolean(),
};
const roundRef = z
  .strictObject({ id: idSchema, status: roundStatusSchema })
  .nullable();
/** The highest monthly AI-round cap any deploy may configure (DEC-183, ISSUE-646). */
export const AI_ROUND_MONTHLY_CAP_MAX = 1000;
/** Refusal order: the host's beta eligibility, its allowance, then global bot capacity. */
export const botAdmissionRefusals = [
  'not-eligible',
  'allowance',
  'capacity',
] as const;
/** The closed Room refusal vocabulary every Room command and creation answers with. */
export const roomRefusalSchema = z.enum([
  'version-conflict',
  'host-required',
  'room-closed',
  'illegal-config',
  'seat-unavailable',
  'actor-ineligible',
  'not-seated',
  'incomplete-cast',
  'not-ready',
  'readiness-unavailable',
  'prep-running',
  'prep-unavailable',
  'command-conflict',
  'consent-conflict',
  /** The caller already holds another active Room (ADR 0070). */
  'active-room',
  /** The selected catalog format, revision or preset is not available to this selection (FMT-1). */
  'format-unavailable',
  /** The draw's source cannot supply enough resolutions. */
  'draw-unavailable',
  /** No draw, or the position is not standing. */
  'strike-unavailable',
  /** The form's strike is not the next one: refresh and strike again. */
  'strike-conflict',
  /** The side holding this strike is not yours to strike for. */
  'not-your-turn',
]);
/** Full authoritative projection grammar used at JSON delivery boundaries. */
export const roomViewSchema = z.strictObject({
  id: idSchema,
  version,
  changeVersion: version,
  title: z.string().min(1),
  /** Null while a draw Room has not revealed its resolution. */
  topic: z.string().min(1).nullable(),
  visibility,
  /** Redacted to null for a viewer who may not name a judge seat the host occupies (DEC-174). */
  hostActorId: idSchema.nullable(),
  hostLabel: z.string().nullable(),
  /** Host-only display metadata; admission is rechecked atomically at freeze. */
  botAdmission: z
    .union([
      z.strictObject({ kind: z.literal('unavailable') }),
      /** The cast's only bots judge: the AI judge is free (DEC-186). */
      z.strictObject({ kind: z.literal('free') }),
      z
        .strictObject({
          kind: z.literal('allowance'),
          /** 0 only for a host the beta does not admit to AI Rounds. */
          limit: z.int().min(0).max(AI_ROUND_MONTHLY_CAP_MAX),
          remaining: z.int().min(0).max(AI_ROUND_MONTHLY_CAP_MAX),
          periodStart: z.iso.datetime({ offset: true }),
          periodEnd: z.iso.datetime({ offset: true }),
          refusal: z.enum(botAdmissionRefusals).nullable(),
        })
        .refine((allowance) => allowance.remaining <= allowance.limit),
    ])
    .nullable(),
  status: z.enum(['assembling', 'ready', 'started', 'abandoned']),
  formatId: z.string().min(1),
  formatVersion: version,
  presetVersion: version.nullable(),
  /**
   * What the room runs and whether it is still its standard (FMT-1).
   * Viewer-safe for every reader: names, roles and a typed change list,
   * never a host-authored list or config object.
   */
  format: z.strictObject({
    name: z.string().min(1),
    role: z.enum(['standard', 'template']).nullable(),
    leagues: z.array(z.string()).readonly(),
    basis: z
      .strictObject({
        formatId: z.string().min(1),
        name: z.string().min(1),
        formatVersion: version,
        presetVersion: version,
        /** Whether the pinned basis preset strikes its resolution: Back must know. */
        strikes: z.boolean(),
      })
      .nullable(),
    standing: formatStandingSchema,
  }),
  competitionType: z.enum(competitionTypes),
  definition: formatDefinitionSchema,
  config: frozenRoomConfigSchema,
  executionPlan: frozenRoomExecutionPlanSchema,
  /** The host's own resolution list, for its author while assembling only. */
  authoredDrawSource: z
    .strictObject({ resolutions: z.array(z.string().min(1)).readonly() })
    .nullable(),
  resolutionDraw: resolutionDrawViewSchema.nullable(),
  rules: roundRulesSchema,
  participants: z
    .array(
      z.union([
        participant.extend(seatState),
        /** A human judge for a viewer who is neither that judge nor the host (DEC-174). */
        z.strictObject({
          role: z.literal('judge'),
          kind: z.literal('human'),
          slot: z.int().nonnegative(),
          anonymous: z.literal(true),
          ...seatState,
        }),
      ]),
    )
    .readonly(),
  readiness: z.strictObject({
    available: z.boolean(),
    version,
    readyActorIds: z.array(idSchema).readonly(),
  }),
  prep: z.strictObject({
    startedAt: nullableTimestamp,
    remainingMs: z.int().nonnegative().nullable(),
    finished: z.boolean(),
  }),
  capabilities: z.strictObject({
    host: z.boolean(),
    canEdit: z.boolean(),
    canClaimSeat: z.boolean(),
    canReady: z.boolean(),
    canStartPreRound: z.boolean(),
    canStrike: z.boolean(),
    canFinishPrep: z.boolean(),
    canStart: z.boolean(),
  }),
  startRefusal: roomRefusalSchema.nullable(),
  roundRef,
});
/**
 * One format the picker offers (FMT-1): a Daisy standard or a league
 * template at its current revision and canonical preset. Structure only
 * (DEC-243): nothing here configures judging.
 */
export const roomCatalogChoiceSchema = z.strictObject({
  formatId: z.string().min(1),
  formatVersion: version,
  label: z.string(),
  role: z.enum(['standard', 'template']),
  family: z.enum(['policy', 'value', 'parli', 'other']).nullable(),
  leagues: z.array(z.string()).readonly(),
  searchTerms: z.string(),
  sortOrder: z.int(),
  rulesEdition: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  definition: formatDefinitionSchema,
  preset: z.strictObject({ version, config: formatSettingsSchema }),
});
export const roomCastChoiceSchema = z.strictObject({
  actorId: idSchema,
  label: z.string(),
  kind: z.literal('bot'),
  eligible: z.boolean(),
});
export type RoomView = z.infer<typeof roomViewSchema>;
export type RoomCatalogChoice = z.infer<typeof roomCatalogChoiceSchema>;
export type RoomCastChoice = z.infer<typeof roomCastChoiceSchema>;
