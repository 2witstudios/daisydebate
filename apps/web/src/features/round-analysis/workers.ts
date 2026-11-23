import { deadlineSignal, type Waits } from '@daisy/clock';
import { type WorkWake } from '@daisy/worker';
import type { RoundAnalysisPolicy } from '@daisy/config';
import type { ErrorReporter } from '@daisy/observability';
import { createRoundAnalysisOperations } from './operations';
import { startRoundAnalysisService } from './service';
import type { App } from '../../server/app';
import { createProviderBudget } from '../../server/provider-budget';
import { workerFailures } from '../../server/recoverable-failure';

/**
 * Round analysis's own worker and lifecycle (DEC-247): its own policy, its
 * own provider budget and its own model. It shares no counter with judging
 * or bot speech, so it can never take competitive capacity.
 */
export function startRoundAnalysisWorkers(input: {
  readonly app: App;
  readonly policy: RoundAnalysisPolicy;
  readonly waits: Waits;
  readonly wake?: WorkWake | undefined;
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
    analyse: async (seat, signal) => {
      const bound = deadlineSignal(input.waits, policy.callTimeoutMs, signal);
      try {
        return await operations.analyse(seat, bound.signal);
      } finally {
        bound.clear();
      }
    },
    limits: {
      parallel: policy.concurrency,
      scanBatch: policy.scanBatch,
      scanMs: policy.scanMs,
    },
    waits: input.waits,
    wake: input.wake,
    failed: failure(
      'round.analysis.failed',
      'round.analysis',
      'Round analysis work remains recoverable',
    ),
  });
}
