import { z } from 'zod';
import { idSchema, debateRoleSchema } from './primitives';
import { formatDefinitionSchema, roundRulesSchema } from './format';
import { roomConfigSchema, roomExecutionPlanSchema } from './room';
import { competitionTypes, roundStatusSchema } from './round';
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
]);
/** Full authoritative projection grammar used at JSON delivery boundaries. */
export const roomViewSchema = z.strictObject({
  id: idSchema,
  version,
  changeVersion: version,
  title: z.string().min(1),
  topic: z.string().min(1),
  visibility,
  /** Redacted to null for a viewer who may not name a judge seat the host occupies (DEC-174). */
  hostActorId: idSchema.nullable(),
  hostLabel: z.string().nullable(),
  /** Host-only display metadata; admission is rechecked atomically at freeze. */
  botAdmission: z
    .union([
      z.strictObject({ kind: z.literal('unavailable') }),
      z.strictObject({
        kind: z.literal('allowance'),
        limit: z.union([z.literal(1), z.literal(10)]),
        remaining: z.int().min(0).max(10),
        periodStart: z.iso.datetime({ offset: true }),
        periodEnd: z.iso.datetime({ offset: true }),
        refusal: z.enum(['allowance', 'capacity']).nullable(),
      }),
    ])
    .nullable(),
  status: z.enum(['assembling', 'ready', 'started', 'abandoned']),
  formatId: z.string().min(1),
  formatVersion: version,
  presetVersion: version.nullable(),
  competitionType: z.enum(competitionTypes),
  definition: formatDefinitionSchema,
  config: roomConfigSchema,
  executionPlan: roomExecutionPlanSchema,
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
    canStartPrep: z.boolean(),
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
  preset: z.strictObject({ version, config: roomConfigSchema }),
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
