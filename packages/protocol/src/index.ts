import { z } from 'zod';
import { idSchema, debateRoleSchema, debateSideSchema } from './primitives';
export const phaseSchema = z.enum(['waiting', 'active', 'completed']);
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
const participantSchema = z.strictObject({
  id: idSchema,
  side: debateSideSchema,
  ready: z.boolean(),
});
/** A format's slug identity (`formats.id`): lowercase, digits and hyphens. */
const formatIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);
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
/**
 * Named re-exports, not `export *` (AGENTS.md: explicit exports, no
 * barrels). This is `@daisy/protocol`'s only public entry point: every
 * symbol here has a consumer outside the package, and a contract piece is
 * added in the same change as its first consumer (knip's
 * `includeEntryExports` fails an export nobody imports).
 */
export { idSchema, debateSides, debateRoles, errorSchema } from './primitives';
export type { ProtocolError } from './primitives';
export {
  emailDeliveryStatuses,
  emailDeliveryStatusRank,
  emailSuppressionReasons,
} from './email-delivery';
export type {
  EmailDeliveryStatus,
  EmailSuppressionReason,
} from './email-delivery';
export { buildUserInboxTopic, buildDebateTopic } from './topics';
export { closeCodeTable } from './close-codes';
export type { CloseCodeReason } from './close-codes';
export {
  outboxPayloadSchema,
  isPayloadStorableOnTopic,
} from './realtime-payloads';
export {
  ENVELOPE_VERSION,
  PROTOCOL_VERSION,
  cursorSchema,
  presenceActivitySchema,
  presenceStatuses,
  clientMessageSchema,
  ticketSchema,
} from './realtime';
export type { PresenceActivity, PresenceStatus } from './realtime';
