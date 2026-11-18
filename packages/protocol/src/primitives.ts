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
 * Daisy's rating styles (ADR 0142, ADR 0146): Freestyle, the one standard, is
 * the one style. A ladder is a style in a division (`./ladder`), so a style
 * added here yields its Open and Youth ladders; the style CHECKs on
 * `ratings`, `rating_changes`, `rounds` and `challenges` derive from this
 * list, so a later style extends it rather than a literal.
 */
export const ratingStyles = ['freestyle'] as const;
export type RatingStyle = (typeof ratingStyles)[number];

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

/** Stable catalog identities, never mutable format names or revisions. */
export const canonicalRatingStyle = (formatId: string): RatingStyle | null =>
  ratingStyles.find((ladder) => ladder === formatId) ?? null;
