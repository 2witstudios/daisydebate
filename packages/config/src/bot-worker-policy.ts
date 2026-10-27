import { z } from 'zod';
import { optionalJsonConfig } from './json-config';
const positive = z.number().int().positive();
export const workerModel = z.string().regex(/^[a-z0-9][a-z0-9._:/-]{0,199}$/i);
const policy = z
  .strictObject({
    maxControllers: positive,
    scanBatch: positive.max(64),
    scanMs: positive.max(500),
    leaseMs: positive.max(60000),
    renewMs: positive,
    callTimeoutMs: positive.max(60000),
    models: z.strictObject({
      speech: workerModel,
      cross_ex: workerModel,
      tts: workerModel,
    }),
  })
  .refine(
    (value) =>
      value.renewMs * 2 < value.leaseMs && value.scanMs < value.renewMs,
  );
/** Bot debaters only: local resource capacity is separate from admitted Round capacity and member allowance. */
export const botWorkerPolicyConfig = optionalJsonConfig(policy);
export type RoundBotWorkerPolicy = z.output<typeof policy>;
