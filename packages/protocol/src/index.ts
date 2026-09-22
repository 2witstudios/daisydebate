import { z } from 'zod';
/**
 * Entity identifiers are cuid2 (`@paralleldrive/cuid2`): 24 lowercase
 * alphanumeric characters. The shape is validated at the trust boundary;
 * id minting stays app-side and is never derived from input. Exactly one
 * shape is accepted (ADR 0023): parsing never normalizes or repairs input.
 */
export const cuid2IdPattern = /^[a-z0-9]{24}$/;
export const idSchema = z.string().regex(cuid2IdPattern);
export const phaseSchema = z.enum(['waiting', 'active', 'completed']);
/**
 * The one debate role vocabulary (ADR 0029). Every seat map, CHECK constraint
 * and role rule derives from this array; spectators are Redis presence, not a
 * durable role. Widening it is a forward migration.
 */
export const debateRoles = ['affirmative', 'negative', 'judge'] as const;
export type DebateRole = (typeof debateRoles)[number];
export const debateRoleSchema = z.enum(debateRoles);
const seatCountSchema = z.int().min(0);
/**
 * Format rules stored in `formats.rules`. `seats` is exhaustive over the role
 * vocabulary: a zod 4 `record` over an enum key requires every key. `clock`
 * holds integer millisecond durations: one speech and one side's total prep.
 */
export const formatRulesSchema = z.strictObject({
  version: z.literal(1),
  seats: z.record(debateRoleSchema, seatCountSchema),
  clock: z.strictObject({
    speechMs: z.int().positive(),
    prepMs: z.int().min(0),
  }),
});
export type FormatRules = z.infer<typeof formatRulesSchema>;
export const participantSchema = z.strictObject({
  id: idSchema,
  side: z.enum(['affirmative', 'negative']),
  ready: z.boolean(),
});
/** A format's slug identity (`formats.id`): lowercase, digits and hyphens. */
export const formatIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
/**
 * `format` names the canonical format the debate belongs to (rating ladders
 * key on it); `rules` are the effective rules this debate actually runs
 * under. A lobby may override the canonical rules; a ranked debate may not
 * (ADR 0030). Copying the rules into the snapshot keeps a debate replayable
 * even after the canonical format changes.
 */
export const debateSnapshotSchema = z.strictObject({
  version: z.literal(1),
  id: idSchema,
  resolution: z.string().trim().min(1).max(500),
  format: formatIdSchema,
  rules: formatRulesSchema,
  phase: phaseSchema,
  createdAt: z.iso.datetime(),
  participants: z.array(participantSchema).max(2),
});
export type DebateSnapshot = z.infer<typeof debateSnapshotSchema>;
export type Participant = z.infer<typeof participantSchema>;
export type DebatePhase = z.infer<typeof phaseSchema>;
const commandBase = {
  version: z.literal(1),
  commandId: idSchema,
  debateId: idSchema,
};
export const commandSchema = z.discriminatedUnion('type', [
  z.strictObject({
    ...commandBase,
    type: z.literal('debate.join'),
    participantId: idSchema,
    side: participantSchema.shape.side,
  }),
  z.strictObject({
    ...commandBase,
    type: z.literal('debate.ready'),
    participantId: idSchema,
  }),
  z.strictObject({
    ...commandBase,
    type: z.literal('debate.transition'),
    phase: phaseSchema,
  }),
]);
export const eventSchema = z.strictObject({
  version: z.literal(1),
  type: z.literal('debate.phase-changed'),
  eventId: idSchema,
  debateId: idSchema,
  occurredAt: z.iso.datetime(),
  phase: phaseSchema,
});
export const errorSchema = z.strictObject({
  version: z.literal(1),
  type: z.literal('error'),
  code: z.enum([
    'VALIDATION',
    'AUTHENTICATION',
    'AUTHORIZATION',
    'NOT_FOUND',
    'CONFLICT',
    'PAYLOAD_TOO_LARGE',
    'INVARIANT',
    'RATE_LIMIT',
    'INFRASTRUCTURE',
    'INTERNAL',
  ]),
  message: z.string(),
  requestId: z.string().max(128),
  invariantId: z.string().trim().min(1).max(128).optional(),
});
export type Command = z.infer<typeof commandSchema>;
export type DebateEvent = z.infer<typeof eventSchema>;
export type ProtocolError = z.infer<typeof errorSchema>;
