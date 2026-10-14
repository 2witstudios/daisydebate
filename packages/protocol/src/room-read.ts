import { z } from 'zod';
import { idSchema, debateRoleSchema } from './primitives';
import { formatDefinitionSchema, roundRulesSchema } from './format';
import { roomConfigSchema, roomExecutionPlanSchema } from './room';
import { roundLengthSchema, roundStatusSchema } from './round';
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
const refusal = z.enum([
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
]);
/** Full authoritative projection grammar used at JSON delivery boundaries. */
export const roomViewSchema = z.strictObject({
  id: idSchema,
  version,
  changeVersion: version,
  title: z.string().min(1),
  topic: z.string().min(1),
  visibility,
  hostActorId: idSchema,
  hostLabel: z.string(),
  status: z.enum(['assembling', 'ready', 'started', 'abandoned']),
  formatId: z.string().min(1),
  formatVersion: version,
  presetVersion: version.nullable(),
  competitionType: z.enum(['casual', 'practice', 'ranked']),
  length: roundLengthSchema,
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
  startRefusal: refusal.nullable(),
  roundRef,
});
export const roomCatalogChoiceSchema = z.strictObject({
  formatId: z.string().min(1),
  formatVersion: version,
  label: z.string(),
  definition: formatDefinitionSchema,
  defaultConfig: roomConfigSchema,
  presets: z
    .array(
      z.strictObject({
        version,
        length: roundLengthSchema,
        config: roomConfigSchema,
      }),
    )
    .readonly(),
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
