import { sha3Hex } from '@daisy/digest';
import { z } from 'zod';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol/primitives';
export const policy = z.strictObject({
  leaseMs: z.number().int().min(1).max(60000),
  quietMs: z.number().int().min(100).max(60000),
  maxAttempts: z.number().int().min(1).max(64),
  retryBaseMs: z.number().int().min(1000).max(300000),
  model: z.string().min(1).max(256),
  qualityPolicyDigest: z.string().regex(/^[a-f0-9]{64}$/),
});
export type Policy = z.infer<typeof policy> & { readonly policyDigest: string };
export const workerInput = z.strictObject({ workerId: idSchema });
/** Parse only owning scope; a complete returned claim may carry read-only model/manifest facts too. */
export const claimInput = z.object({
  roundId: idSchema,
  contextId: idSchema,
  claim: z.strictObject({
    workerId: idSchema,
    epoch: z.number().int().min(1).max(2147483647),
    token: z.string().regex(/^[A-Za-z0-9_-]{43,128}$/),
  }),
});
export type Claim = z.infer<typeof claimInput>;
