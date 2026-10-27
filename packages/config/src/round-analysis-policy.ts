import { z } from 'zod';
import { workerModel } from './bot-worker-policy';
import { optionalJsonConfig } from './json-config';
const positive = z.number().int().positive();
const policy = z.strictObject({
  /** Concurrent analysis calls: round analysis's own provider budget, never the competitive one. */
  concurrency: positive.max(64),
  scanBatch: positive.max(64),
  scanMs: positive.max(60000),
  /** A lease covers its whole call, so it is longer than the timeout. */
  leaseMs: positive.max(60000),
  callTimeoutMs: positive.max(120000),
  model: workerModel,
});
/** Round analysis runs if and only if this is set (DEC-247, ISSUE-749). */
export const roundAnalysisPolicyConfig = optionalJsonConfig(policy);
export type RoundAnalysisPolicy = z.output<typeof policy>;
