import { aiRoundAllowance } from '@daisy/auth/authorization';
import type { RoundBotWorkerPolicy } from '@daisy/config';
import type { createDatabase } from '@daisy/db';
import { createAppError } from '@daisy/errors';
/** Explicit policy only; existing-pool composition remains owned by createDatabase. */
export function roundWorkerDatabaseOptions(
  policy: RoundBotWorkerPolicy | undefined,
  nextToken: (() => string) | undefined,
): Pick<
  Parameters<typeof createDatabase>[0],
  'judging' | 'botPublication' | 'coaching'
> {
  if (!policy) return {};
  if (!nextToken)
    throw createAppError('INFRASTRUCTURE', 'Worker token producer is required');
  return {
    judging: { leaseMs: policy.leaseMs, model: policy.models.judge, nextToken },
    // A coaching lease covers its whole provider call: no renewal (ADR 0071).
    coaching: {
      leaseMs: policy.callTimeoutMs + policy.leaseMs,
      model: policy.models.judge,
      nextToken,
    },
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

/**
 * Live bot-debater admission (DEC-183/DEC-186): an explicit busy cap and the
 * trusted flat beta quota together. No busy cap admits no bot debater.
 */
export function botAdmissionOptions(config: {
  readonly AI_ROUND_BUSY_CAP?: number | undefined;
  readonly AI_ROUND_MONTHLY_CAP: number;
}): Pick<Parameters<typeof createDatabase>[0], 'botAdmission'> {
  const busyCap = config.AI_ROUND_BUSY_CAP;
  if (busyCap === undefined) return {};
  const monthlyCap = config.AI_ROUND_MONTHLY_CAP;
  return {
    botAdmission: {
      busyCap,
      allowance: (account) => aiRoundAllowance(account, { monthlyCap }),
    },
  };
}
