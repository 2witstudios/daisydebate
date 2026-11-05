import { judgeContractVersion } from '@daisy/ai-voice';
import { judgingJobRules } from '@daisy/debate-engine';
import { admitAllowance, canUseAiAllowance } from '@daisy/auth/authorization';
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
            contractVersion: judgeContractVersion,
            rules: judgingJobRules,
            accountEligible: canUseAiAllowance,
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
            accountEligible: canUseAiAllowance,
            nextToken,
          },
        }
      : {}),
    // A round analysis lease covers its whole provider call: no renewal.
    ...(analysis
      ? {
          roundAnalysis: {
            capacity: analysis.concurrency * 4,
            leaseMs: analysis.callTimeoutMs + analysis.leaseMs,
            model: analysis.model,
            nextToken,
          },
        }
      : {}),
  };
}

/**
 * One account allowance policy for every AI consumer. A bot busy cap enables
 * bot-debater admission only; judging and analysis keep their own capacity.
 */
export function aiAdmissionOptions(config: {
  readonly AI_ROUND_BUSY_CAP?: number | undefined;
  readonly AI_ROUND_MONTHLY_CAP: number;
  readonly PREMIUM_BETA_GRANT: boolean;
}): Pick<DatabaseOptions, 'botAdmission' | 'aiAllowance'> {
  const busyCap = config.AI_ROUND_BUSY_CAP;
  const monthlyCap = config.AI_ROUND_MONTHLY_CAP;
  return {
    ...(busyCap === undefined ? {} : { botAdmission: { busyCap } }),
    aiAllowance: {
      accountEligible: canUseAiAllowance,
      decide: (account, facts, request, now) =>
        admitAllowance(account, facts, request, {
          betaMonthlyCap: monthlyCap,
          now,
          betaGrantsPremium: config.PREMIUM_BETA_GRANT,
        }),
    },
  };
}

/** The room a bot debater publishes into; absent, a worker has no way to speak. */
export const mediaConfigured = (
  config: Pick<
    ServerConfig,
    | 'LIVEKIT_URL'
    | 'LIVEKIT_PUBLIC_URL'
    | 'LIVEKIT_API_KEY'
    | 'LIVEKIT_API_SECRET'
  >,
) =>
  [
    config.LIVEKIT_URL,
    config.LIVEKIT_PUBLIC_URL,
    config.LIVEKIT_API_KEY,
    config.LIVEKIT_API_SECRET,
  ].every(Boolean);

/** The AI seats a deployment can actually serve; a Room offers no other. */
export type AiSeatAvailability = {
  readonly debater: boolean;
  readonly judge: boolean;
};

/**
 * Each seat from its own key, policy and capacity (ISSUE-1017). A key alone
 * serves neither: without a policy no worker runs the seat, and a bot debater
 * also needs the busy cap its Launch is admitted under and a room to speak in.
 */
export function aiSeatAvailability(
  config: Pick<
    ServerConfig,
    | 'OPENROUTER_API_KEY'
    | 'COMPETITIVE_PROVIDER_CONCURRENCY'
    | 'ROUND_BOT_WORKER_POLICY'
    | 'ROUND_JUDGING_POLICY'
    | 'AI_ROUND_BUSY_CAP'
    | 'LIVEKIT_URL'
    | 'LIVEKIT_PUBLIC_URL'
    | 'LIVEKIT_API_KEY'
    | 'LIVEKIT_API_SECRET'
  >,
): AiSeatAvailability {
  const provider =
    Boolean(config.OPENROUTER_API_KEY) &&
    config.COMPETITIVE_PROVIDER_CONCURRENCY !== undefined;
  return {
    debater:
      provider &&
      config.ROUND_BOT_WORKER_POLICY !== undefined &&
      config.AI_ROUND_BUSY_CAP !== undefined &&
      mediaConfigured(config),
    judge: provider && config.ROUND_JUDGING_POLICY !== undefined,
  };
}
