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
export const participantSchema = z.strictObject({
  id: idSchema,
  side: z.enum(['affirmative', 'negative']),
  ready: z.boolean(),
});
export const debateSnapshotSchema = z.strictObject({
  version: z.literal(1),
  id: idSchema,
  resolution: z.string().trim().min(1).max(500),
  format: z.literal('foundation'),
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
