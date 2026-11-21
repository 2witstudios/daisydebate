import { z } from 'zod';
import { botWorkerPolicyConfig } from './bot-worker-policy';
import { judgingPolicyConfig } from './judging-policy';

export const competitiveFields = {
  AI_ROUND_BUSY_CAP: z.coerce.number().int().positive().optional(),
  /**
   * Concurrent provider calls for competitive work: AI judging and live bot
   * speech share this one budget. Round analysis has its own.
   */
  COMPETITIVE_PROVIDER_CONCURRENCY: z.coerce
    .number()
    .int()
    .positive()
    .max(64)
    .optional(),
  ROUND_BOT_WORKER_POLICY: botWorkerPolicyConfig,
  ROUND_JUDGING_POLICY: judgingPolicyConfig,
};

/**
 * AI judging and bot debaters run only inside the competitive provider
 * budget: a policy for either without the budget would boot, accept AI
 * seats and then never judge or speak, so the configuration is refused.
 */
export function requireCompetitiveBudget(
  config: {
    readonly COMPETITIVE_PROVIDER_CONCURRENCY?: number | undefined;
    readonly ROUND_JUDGING_POLICY?: unknown;
    readonly ROUND_BOT_WORKER_POLICY?: unknown;
  },
  ctx: z.RefinementCtx,
) {
  if (config.COMPETITIVE_PROVIDER_CONCURRENCY !== undefined) return;
  if (
    config.ROUND_JUDGING_POLICY !== undefined ||
    config.ROUND_BOT_WORKER_POLICY !== undefined
  )
    ctx.addIssue({
      code: 'custom',
      path: ['COMPETITIVE_PROVIDER_CONCURRENCY'],
      message: 'AI judging and bot workers need the competitive budget',
    });
}
