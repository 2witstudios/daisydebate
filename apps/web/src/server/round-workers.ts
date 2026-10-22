import { createAttendanceFeature } from '../features/attendance/operations';
import { createBotControl } from '../features/round-bots/control';
import { startBotControlService } from '../features/round-bots/control-service';
import type { App } from './app';
import { createProviderCapacity } from '../features/round-bots/provider-capacity';
import { createRoundJudgingOperations } from '../features/round-judging/operations';
import { startRoundJudgingService } from '../features/round-judging/service';

/** Provider work owns an independent lifecycle; availability/competitive maintenance never await it. */
export function startRoundWorkers(input: {
  readonly app: App;
  readonly instanceId: string;
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
  const judging = startRoundJudgingService({
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
  const attendance = createAttendanceFeature({
    checkIns: app.database,
    evaluate: app.database.evaluateRoundAttendance,
    nextId: () => app.ids.next(),
    instanceId: input.instanceId,
  });
  const control = startBotControlService({
    store: app.database,
    control: (claim) =>
      createBotControl({
        claim,
        store: app.database,
        attendance,
        nextId: () => app.ids.next(),
      }),
    limits: {
      maxControllers: policy.maxControllers,
      scanBatch: policy.scanBatch,
      scanMs: policy.scanMs,
      renewMs: policy.renewMs,
    },
    timers: input.timers,
    failed: () =>
      app.logger.log(
        'round.control.failed',
        { operation: 'round.control', errorCode: 'INFRASTRUCTURE' },
        'Control receipt work remains recoverable',
      ),
  });
  return {
    started: Promise.all([judging.started, control.started]),
    stop: async () => {
      await Promise.all([judging.stop(), control.stop()]);
    },
  };
}
