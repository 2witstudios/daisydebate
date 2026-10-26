import type { RoundBotWorkerPolicy } from '@daisy/config';
import type { createDatabase } from '@daisy/db';
import { createAppError } from '@daisy/errors';
/** Explicit policy only; existing-pool composition remains owned by createDatabase. */
export function roundWorkerDatabaseOptions(
  policy: RoundBotWorkerPolicy | undefined,
  nextToken: (() => string) | undefined,
): Pick<Parameters<typeof createDatabase>[0], 'judging' | 'botPublication'> {
  if (!policy) return {};
  if (!nextToken)
    throw createAppError('INFRASTRUCTURE', 'Worker token producer is required');
  return {
    judging: { leaseMs: policy.leaseMs, model: policy.models.judge, nextToken },
    botPublication: {
      leaseMs: policy.leaseMs,
      models: {
        speech: policy.models.speech,
        cross_ex: policy.models.cross_ex,
      },
      ttsModel: policy.models.tts,
      speechBudget: 30_000,
      nextToken,
    },
  };
}
