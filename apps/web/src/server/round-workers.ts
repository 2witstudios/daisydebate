import type { ErrorReporter } from '@daisy/observability';
import type { App } from './app';
import { createProviderBudget } from './provider-budget';
import { startRoundAnalysisWorkers } from './round-analysis-workers';
import { startRoundBotWorkers } from './round-bot-workers';
import { startRoundJudgingWorkers } from './round-judging-workers';
import type { WorkerTimers } from './worker-timers';

type Started = {
  readonly started: Promise<unknown>;
  readonly stop: () => Promise<void>;
};

/**
 * Starts each provider worker its own policy configures (ISSUE-749), each
 * with an independent lifecycle; availability/competitive maintenance never
 * await them. AI judging and bot speech share the competitive provider
 * budget; round analysis has its own.
 */
export function startRoundWorkers(input: {
  readonly app: App;
  readonly instanceId: string;
  readonly timers: WorkerTimers;
  readonly botToken: Parameters<typeof startRoundBotWorkers>[0]['botToken'];
  /** Scrubbed raw-error destination (ADR 0037); inert until configured. */
  readonly reporter?: ErrorReporter;
}) {
  const { app } = input;
  const concurrency = app.config.COMPETITIVE_PROVIDER_CONCURRENCY;
  const competitive = concurrency ? createProviderBudget(concurrency) : null;
  const judging = app.config.ROUND_JUDGING_POLICY;
  const bots = app.config.ROUND_BOT_WORKER_POLICY;
  const analysis = app.config.ROUND_ANALYSIS_POLICY;
  const workers: Started[] = [
    ...(judging && competitive && concurrency
      ? [
          startRoundJudgingWorkers({
            ...input,
            policy: judging,
            budget: competitive,
            parallel: concurrency,
          }),
        ]
      : []),
    ...(bots && competitive
      ? [startRoundBotWorkers({ ...input, policy: bots, budget: competitive })]
      : []),
    ...(analysis
      ? [startRoundAnalysisWorkers({ ...input, policy: analysis })]
      : []),
  ];
  if (!workers.length) return null;
  return {
    started: Promise.all(workers.map((worker) => worker.started)),
    stop: async () => {
      await Promise.all(workers.map((worker) => worker.stop()));
    },
  };
}
