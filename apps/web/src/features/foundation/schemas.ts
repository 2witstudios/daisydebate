import { z } from 'zod';

export const proofDebateInputSchema = z.strictObject({
  resolution: z.string().trim().min(1).max(500),
});

export const proofDebateIdSchema = z.uuid();
