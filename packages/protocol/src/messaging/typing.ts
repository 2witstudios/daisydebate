import { z } from 'zod';
import { idSchema } from '../primitives';
const positive = z.number().int().positive().safe();
const scope = { version: z.literal(1), channelId: idSchema };
/** A typing hint carries no projection; HTTP exposes only a fresh aggregate. */
export const messagingTypingSchemas = {
  scope: z.strictObject(scope),
  update: z.strictObject({ ...scope, typing: z.boolean() }),
  result: z.strictObject({
    ...scope,
    typing: z.boolean(),
    refreshAfterMs: positive,
  }),
  policy: z
    .strictObject({
      ttlMs: positive,
      refetchMs: positive,
      maxActors: positive.max(65535),
    })
    .refine((policy) => policy.refetchMs <= policy.ttlMs),
  lease: z.strictObject({
    ...scope,
    actorId: idSchema,
    authorityRevision: positive,
    relationshipRevision: positive,
    accountRevision: positive,
    ageRevision: positive,
    policyRevision: positive,
    expiresAt: z.iso.datetime(),
  }),
};
