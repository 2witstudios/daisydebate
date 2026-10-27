import { aiRoundAllowance } from '@daisy/auth/authorization';
import type { ServerConfig } from '@daisy/config';
import type { createDatabase } from '@daisy/db';
import { createAppError } from '@daisy/errors';

type DatabaseOptions = Parameters<typeof createDatabase>[0];

/**
 * Each worker's database options from its own explicit policy (ISSUE-749):
 * AI judging, bot debaters and round analysis are configured apart, and an
 * absent policy leaves that store absent. Existing-pool composition remains
 * owned by createDatabase.
 */
export function roundWorkerDatabaseOptions(
  config: Pick<
    ServerConfig,
    'ROUND_JUDGING_POLICY' | 'ROUND_BOT_WORKER_POLICY' | 'ROUND_ANALYSIS_POLICY'
  >,
  nextToken: (() => string) | undefined,
): Pick<DatabaseOptions, 'judging' | 'botPublication' | 'roundAnalysis'> {
  const judging = config.ROUND_JUDGING_POLICY;
  const bots = config.ROUND_BOT_WORKER_POLICY;
  const analysis = config.ROUND_ANALYSIS_POLICY;
  if (!judging && !bots && !analysis) return {};
  if (!nextToken)
    throw createAppError('INFRASTRUCTURE', 'Worker token producer is required');
  return {
    ...(judging
      ? {
          judging: {
            leaseMs: judging.leaseMs,
            model: judging.model,
            nextToken,
          },
        }
      : {}),
    ...(bots
      ? {
          botPublication: {
            leaseMs: bots.leaseMs,
            models: {
              speech: bots.models.speech,
              cross_ex: bots.models.cross_ex,
            },
            ttsModel: bots.models.tts,
            speechBudget: 30_000,
            nextToken,
          },
        }
      : {}),
    // A round analysis lease covers its whole provider call: no renewal.
    ...(analysis
      ? {
          roundAnalysis: {
            leaseMs: analysis.callTimeoutMs + analysis.leaseMs,
            model: analysis.model,
            nextToken,
          },
        }
      : {}),
  };
}

/**
 * Live bot-debater admission (DEC-183/DEC-186): an explicit busy cap and the
 * trusted flat quota on the account's own ai_rounds grant together. No busy
 * cap admits no bot debater.
 */
export function botAdmissionOptions(config: {
  readonly AI_ROUND_BUSY_CAP?: number | undefined;
  readonly AI_ROUND_MONTHLY_CAP: number;
}): Pick<DatabaseOptions, 'botAdmission'> {
  const busyCap = config.AI_ROUND_BUSY_CAP;
  if (busyCap === undefined) return {};
  const monthlyCap = config.AI_ROUND_MONTHLY_CAP;
  return {
    botAdmission: {
      busyCap,
      allowance: (account, grants) =>
        aiRoundAllowance(account, grants, { monthlyCap }),
    },
  };
}
