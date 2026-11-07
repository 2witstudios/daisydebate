import type { RoundAnalysisPolicy } from '@daisy/config';
import type { ErrorReporter } from '@daisy/observability';
import { createRoundAnalysisOperations } from '../features/round-analysis/operations';
import { startRoundAnalysisService } from '../features/round-analysis/service';
import type { App } from './app';
import { createProviderBudget } from './provider-budget';
import { workerFailures } from './recoverable-failure';
import type { WorkerTimers } from '../lib/worker-timers';

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
    store: app.database,
    voice: app.aiVoice,
    withProvider: budget,
  });
  return startRoundAnalysisService({
    scan: (limit) => app.database.scanRoundAnalysisJobs(limit),
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
