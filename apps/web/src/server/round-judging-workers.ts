import type { RoundJudgingPolicy } from '@daisy/config';
import type { ErrorReporter } from '@daisy/observability';
import { createRoundJudgingOperations } from '../features/round-judging/operations';
import { startRoundJudgingService } from '../features/round-judging/service';
import type { App } from './app';
import type { createProviderBudget } from './provider-budget';
import { workerFailures } from './recoverable-failure';
import type { WorkerTimers } from './worker-timers';

/** AI judging's own worker (ISSUE-749), drawing on the competitive provider budget. */
export function startRoundJudgingWorkers(input: {
  readonly app: App;
  readonly policy: RoundJudgingPolicy;
  readonly budget: ReturnType<typeof createProviderBudget>;
  readonly parallel: number;
  readonly timers: WorkerTimers;
  readonly reporter?: ErrorReporter;
}) {
  const { app, policy } = input;
  const failure = workerFailures(app, input.reporter);
  const operations = createRoundJudgingOperations({
    store: app.database,
    nextId: () => app.ids.next(),
    voice: app.aiVoice,
    // The service reserves before claiming and holds admission through retries.
    withProvider: (_signal, work) => work(),
  });
  return startRoundJudgingService({
    reserveCapacity: () => input.budget.reserve(),
    store: app.database,
    execute: (claim, signal) =>
      operations.executeClaim(
        claim,
        AbortSignal.any([signal, AbortSignal.timeout(policy.callTimeoutMs)]),
      ),
    limits: {
      parallel: input.parallel,
      scanBatch: policy.scanBatch,
      scanMs: policy.scanMs,
      renewMs: policy.renewMs,
    },
    timers: input.timers,
    failed: failure(
      'round.judging.failed',
      'round.judging',
      'Judging work remains recoverable',
    ),
  });
}
