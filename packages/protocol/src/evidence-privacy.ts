import { z } from 'zod';
import { idSchema } from './primitives';
import { MAX_FORMAT_SEATS } from './format';

export const evidencePrivacyScopeSchema = z
  .strictObject({
    roundId: idSchema,
    subjectActorIds: z.array(idSchema).max(MAX_FORMAT_SEATS + 1),
  })
  .refine((scope) =>
    scope.subjectActorIds.every(
      (id, index) => index === 0 || scope.subjectActorIds[index - 1]! < id,
    ),
  );
export type EvidencePrivacyScope = z.infer<typeof evidencePrivacyScopeSchema>;
/** Bounded canonical scope, never evidence that the supplied authority is current. */
export function encodeEvidencePrivacyScope(input: unknown) {
  if (
    !input ||
    typeof input !== 'object' ||
    !Array.isArray((input as Record<string, unknown>).subjectActorIds) ||
    ((input as Record<string, unknown>).subjectActorIds as unknown[]).length >
      MAX_FORMAT_SEATS + 1
  )
    return null;
  const parsed = evidencePrivacyScopeSchema.safeParse(input);
  return parsed.success
    ? { scope: parsed.data, document: JSON.stringify(parsed.data) }
    : null;
}
export const evidencePrivacyIntentSchema = z.strictObject({
  intentId: idSchema,
  scope: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('subject'),
      actorId: idSchema,
      userId: idSchema,
    }),
    z.strictObject({ kind: z.literal('round'), roundId: idSchema }),
  ]),
  authorizationDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
export type EvidencePrivacyIntent = z.infer<typeof evidencePrivacyIntentSchema>;
export type EvidencePrivacyIntentRecord = {
  readonly kind: 'pending' | 'committed';
  readonly intent: EvidencePrivacyIntent;
  readonly sequence: number;
};
