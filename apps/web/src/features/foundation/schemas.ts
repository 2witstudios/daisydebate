import { z } from 'zod';
import { idSchema } from '@daisy/protocol/primitives';

export const proofDebateInputSchema = z.strictObject({
  resolution: z.string().trim().min(1).max(500),
});

export const proofDebateIdSchema = idSchema;
