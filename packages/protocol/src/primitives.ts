import { z } from 'zod';
/**
 * Entity identifiers are cuid2 (`@paralleldrive/cuid2`): 24 lowercase
 * alphanumeric characters. The shape is validated at the trust boundary;
 * id minting stays app-side and is never derived from input. Exactly one
 * shape is accepted (ADR 0023): parsing never normalizes or repairs input.
 *
 * Split out from index.ts so it has no dependents inside this package:
 * every other protocol module imports it, and none may import index.ts.
 */
export const idSchema = z.string().regex(/^[a-z0-9]{24}$/);

/**
 * The one side vocabulary: the two debating sides. Seat maps, outcomes,
 * ballot decisions and the engine's seat rules all derive from it.
 */
export const debateSides = ['affirmative', 'negative'] as const;
export const debateSideSchema = z.enum(debateSides);

/**
 * The one debate role vocabulary (ADR 0029): the two sides plus the judge.
 * Every seat map, CHECK constraint and role rule derives from this array;
 * spectators are Redis presence, not a durable role. Widening it is a
 * forward migration.
 */
export const debateRoles = [...debateSides, 'judge'] as const;
export const debateRoleSchema = z.enum(debateRoles);

/**
 * The one public error-code vocabulary. `@daisy/errors` maps each code to
 * its HTTP status and fixed public message, keyed by this type, so a code
 * added here fails typecheck there until it has a mapping.
 */
const errorCodes = [
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
] as const;

/** The public error every Daisy surface emits (`@daisy/errors`' `toPublicError`). */
export const errorSchema = z.strictObject({
  version: z.literal(1),
  type: z.literal('error'),
  code: z.enum(errorCodes),
  message: z.string(),
  requestId: z.string().max(128),
  invariantId: z.string().trim().min(1).max(128).optional(),
});
export type ProtocolError = z.infer<typeof errorSchema>;
