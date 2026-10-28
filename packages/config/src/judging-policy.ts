import { z } from 'zod';
import { workerModel } from './bot-worker-policy';
import { optionalJsonConfig } from './json-config';
const positive = z.number().int().positive();
const policy = z
  .strictObject({
    scanBatch: positive.max(64),
    scanMs: positive.max(500),
    leaseMs: positive.max(60000),
    renewMs: positive,
    callTimeoutMs: positive.max(60000),
    model: workerModel,
  })
  .refine(
    (value) =>
      value.renewMs * 2 < value.leaseMs && value.scanMs < value.renewMs,
  );
/** AI judging's own worker policy: the AI judge is not a bot debater (ISSUE-749). */
export const judgingPolicyConfig = optionalJsonConfig(policy);
export type RoundJudgingPolicy = z.output<typeof policy>;
