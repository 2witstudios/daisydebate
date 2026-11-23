import { deadlineSignal, type Waits } from '@daisy/clock';
import { type WorkWake } from '@daisy/worker';
import { reportJudgingRecovery } from './recovery-report';
import type { JudgingTerminalReason } from '@daisy/protocol/round-judging-attempt';
import type { RoundJudgingPolicy } from '@daisy/config';
import { createAppError } from '@daisy/errors';
import type { ErrorReporter } from '@daisy/observability';
import { createRoundJudgingOperations } from './operations';
import { startRoundJudgingService } from './service';
import type { App } from '../../server/app';
import type { createProviderBudget } from '../../server/provider-budget';
import { workerFailures } from '../../server/recoverable-failure';

/** AI judging's own worker (ISSUE-749), drawing on the competitive provider budget. */
export function startRoundJudgingWorkers(input: {
  readonly app: App;
  readonly policy: RoundJudgingPolicy;
  readonly budget: ReturnType<typeof createProviderBudget>;
  readonly parallel: number;
  readonly waits: Waits;
  readonly wake?: WorkWake | undefined;
  readonly reporter?: ErrorReporter;
}) {
  const { app, policy } = input;
  const failure = workerFailures(app, input.reporter);
  const reportEnded = failure(
    'round.judging.failed',
    'round.judging',
    'Judging ended without a ballot',
  );
  const jobEnded = (reason: JudgingTerminalReason) =>
    reportEnded(
      createAppError('INFRASTRUCTURE', `Judging ended: ${reason}`),
      'execute',
    );
  const operations = createRoundJudgingOperations({
    store: app.database,
    nextId: () => app.ids.next(),
    voice: app.aiVoice,
    // The service reserves before claiming and holds admission through retries.
    withProvider: (_signal, work) => work(),
    // The claim's signal below carries the same bound; it starts first, so a
    // slow stage ends as a timeout, never at the client's shorter default.
    callTimeoutMs: policy.callTimeoutMs,
    recoveryPending: (reason) => reportJudgingRecovery(app.logger, reason),
  });
  return startRoundJudgingService({
    reserveCapacity: () => input.budget.reserve(),
    store: app.database,
    execute: async (claim, signal) => {
      const bound = deadlineSignal(input.waits, policy.callTimeoutMs, signal);
      try {
        return await operations.executeClaim(claim, bound.signal);
      } finally {
        bound.clear();
      }
    },
    limits: {
      parallel: input.parallel,
      scanBatch: policy.scanBatch,
      scanMs: policy.scanMs,
      renewMs: policy.renewMs,
      leaseMs: policy.leaseMs,
    },
    waits: input.waits,
    wake: input.wake,
    jobEnded,
    failed: failure(
      'round.judging.failed',
      'round.judging',
      'Judging work remains recoverable',
    ),
  });
}
