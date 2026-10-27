import type { RoundAnalysisPolicy } from '@daisy/config';
import type { ErrorReporter } from '@daisy/observability';
import { canGenerateRoundAnalysis } from '../features/round-analysis/authorization';
import { createRoundAnalysisOperations } from '../features/round-analysis/operations';
import { roundAnalysisPolicy } from '../features/round-analysis/policy';
import { startRoundAnalysisService } from '../features/round-analysis/service';
import type { App } from './app';
import { createProviderBudget } from './provider-budget';
import { workerFailures } from './recoverable-failure';
import type { WorkerTimers } from './worker-timers';

/**
 * Round analysis's own worker and lifecycle (DEC-247): its own policy, its
 * own provider budget and its own model. It shares no counter with judging
 * or bot speech, so it can never take competitive capacity.
 */
export function startRoundAnalysisWorkers(input: {
  readonly app: App;
  readonly policy: RoundAnalysisPolicy;
  readonly timers: WorkerTimers;
  readonly reporter?: ErrorReporter;
}) {
  const { app, policy } = input;
  const failure = workerFailures(app, input.reporter);
  const budget = createProviderBudget(policy.concurrency);
  const operations = createRoundAnalysisOperations({
    betaGrantsPremium: app.config.PREMIUM_BETA_GRANT,
    store: app.database,
    voice: app.aiVoice,
    withProvider: budget,
    now: () => app.clock.now(),
  });
  return startRoundAnalysisService({
    scan: (limit) =>
      app.database.scanRoundAnalysisJobs(
        limit,
        new Date(
          Date.parse(app.clock.now()) - roundAnalysisPolicy.windowMs,
        ).toISOString(),
        (access) =>
          canGenerateRoundAnalysis(access, app.config.PREMIUM_BETA_GRANT),
      ),
    analyse: (seat, signal) =>
      operations.analyse(
        seat,
        AbortSignal.any([signal, AbortSignal.timeout(policy.callTimeoutMs)]),
      ),
    limits: {
      parallel: policy.concurrency,
      scanBatch: policy.scanBatch,
      scanMs: policy.scanMs,
    },
    timers: input.timers,
    failed: failure(
      'round.analysis.failed',
      'round.analysis',
      'Round analysis work remains recoverable',
    ),
  });
}
