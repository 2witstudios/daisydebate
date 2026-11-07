import { z } from 'zod';
import { idSchema } from '@daisy/protocol';
/** Private cleanup claim, never a bearer/public worker discovery DTO. NULL route remains blocked debt. */
export const receipt = z.strictObject({
  kind: z.literal('claimed'),
  reason: z.enum(['settled', 'erased', 'expired', 'unreceived']),
  identity: z.strictObject({
    evidenceId: idSchema,
    bindingDigest: z.string().regex(/^[a-f0-9]{64}$/),
    authorityId: idSchema.nullable(),
  }),
  claim: z.strictObject({
    workerId: idSchema,
    executionEpoch: z.number().int().positive(),
    token: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
  }),
});
