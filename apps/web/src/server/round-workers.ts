import type { App } from './app';
import { createProviderCapacity } from '../features/round-bots/provider-capacity';
import { createRoundJudgingOperations } from '../features/round-judging/operations';
import { startRoundJudgingService } from '../features/round-judging/service';

/** Provider work owns an independent lifecycle; availability/competitive maintenance never await it. */
export function startRoundWorkers(input: {
  readonly app: App;
  readonly timers: Parameters<typeof startRoundJudgingService>[0]['timers'];
}) {
  const { app } = input;
  const policy = app.config.ROUND_BOT_WORKER_POLICY;
  if (!policy) return null;
  const operations = createRoundJudgingOperations({
    store: app.database,
    nextId: () => app.ids.next(),
    voice: app.aiVoice,
    withProvider: createProviderCapacity(policy.providerConcurrency),
  });
  return startRoundJudgingService({
    store: app.database,
    execute: (claim, signal) =>
      operations.executeClaim(
        claim,
        AbortSignal.any([signal, AbortSignal.timeout(policy.callTimeoutMs)]),
      ),
    limits: {
      parallel: policy.providerConcurrency,
      scanBatch: policy.scanBatch,
      scanMs: policy.scanMs,
      renewMs: policy.renewMs,
    },
    timers: input.timers,
    failed: () =>
      app.logger.log(
        'round.judging.failed',
        { operation: 'round.judging', errorCode: 'INFRASTRUCTURE' },
        'Judging work remains recoverable',
      ),
  });
}
