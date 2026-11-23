import { processRoundMedia } from '../features/round-media/work';
import { featureWork, type ProcessWork } from './feature-work';
import type { Waits } from '@daisy/clock';
import type { ErrorReporter } from '@daisy/observability';
import type { App } from './app';
import { createProviderBudget } from './provider-budget';
import { startRoundAnalysisWorkers } from './round-analysis-workers';
import { startRoundBotWorkers } from './round-bot-workers';
import { startRoundJudgingWorkers } from './round-judging-workers';
import type { WorkWakes } from './work-wakes';

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
function startRoundWorkers(input: {
  readonly app: App;
  readonly instanceId: string;
  readonly waits: Waits;
  /** Each worker's wake for the work it looks for (ADR 0154). */
  readonly wakes: WorkWakes;
  /** Bot seat ending deadlines (ISSUE-789). */
  readonly botMedia: Parameters<typeof startRoundBotWorkers>[0]['botMedia'];
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
            wake: input.wakes.of('judging'),
          }),
        ]
      : []),
    ...(bots && competitive
      ? [
          startRoundBotWorkers({
            ...input,
            policy: bots,
            budget: competitive,
            wake: input.wakes.of('round'),
          }),
        ]
      : []),
    ...(analysis
      ? [
          startRoundAnalysisWorkers({
            ...input,
            policy: analysis,
            wake: input.wakes.of('analysis'),
          }),
        ]
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

/**
 * The provider-bound Round work (judging, bot seats, analysis): one start,
 * because the three share one competitive provider budget. The bot seats
 * end their media through this process's one round media runtime.
 */
export const startCompetitiveRoundWork = ({
  app,
  instanceId,
  waits,
  wakes,
}: ProcessWork) => {
  const media = processRoundMedia(app, waits);
  return featureWork({
    roundWorkers: startRoundWorkers({
      app,
      instanceId,
      botMedia: media
        ? {
            botToken: (scope, token) =>
              media.operations().botToken(scope, token),
            listenToken: (scope, token) =>
              media.operations().botListenToken(scope, token),
            readPeers: (scope) => media.operations().botPeers(scope),
          }
        : null,
      waits,
      wakes,
      reporter: app.reporter,
    }),
  });
};
