import { z } from 'zod';
/**
 * Entity identifiers are cuid2 (`@paralleldrive/cuid2`): 24 lowercase
 * alphanumeric characters. The shape is validated at the trust boundary;
 * id minting stays app-side and is never derived from input. Exactly one
 * shape is accepted (ADR 0023): parsing never normalizes or repairs input.
 *
 * Split out from index.ts so it has no dependents inside this package:
 * both index.ts and realtime.ts import it, and neither may import the
 * other without a cycle.
 */
export const cuid2IdPattern = /^[a-z0-9]{24}$/;
export const idSchema = z.string().regex(cuid2IdPattern);

/**
 * The one debate role vocabulary (ADR 0029). Every seat map, CHECK constraint
 * and role rule derives from this array; spectators are Redis presence, not a
 * durable role. Widening it is a forward migration.
 *
 * Also split out here (not index.ts) so realtime.ts can encode the private-
 * debate subscribe-authorization roles as this same data, not a re-typed copy.
 */
export const debateRoles = ['affirmative', 'negative', 'judge'] as const;
export type DebateRole = (typeof debateRoles)[number];
export const debateRoleSchema = z.enum(debateRoles);

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
export type ProtocolError = z.infer<typeof errorSchema>;
