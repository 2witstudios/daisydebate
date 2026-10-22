import { createAttendanceFeature } from '../features/attendance/operations';
import { createBotControl } from '../features/round-bots/control';
import { startBotControlService } from '../features/round-bots/control-service';
import { createSpeakingBotControl } from '../features/round-bots/speaking';
import type { App } from './app';
import { createProviderCapacity } from '../features/round-bots/provider-capacity';
import { createRoundJudgingOperations } from '../features/round-judging/operations';
import { startRoundJudgingService } from '../features/round-judging/service';

/** Provider work owns an independent lifecycle; availability/competitive maintenance never await it. */
export function startRoundWorkers(input: {
  readonly app: App;
  readonly instanceId: string;
  readonly timers: Parameters<typeof startRoundJudgingService>[0]['timers'];
  /** Media broker grant; without configured media, seats keep receipts only. */
  readonly botToken:
    Parameters<typeof createSpeakingBotControl>[0]['botToken'] | null;
}) {
  const { app } = input;
  const policy = app.config.ROUND_BOT_WORKER_POLICY;
  if (!policy) return null;
  const withProvider = createProviderCapacity(policy.providerConcurrency);
  const operations = createRoundJudgingOperations({
    store: app.database,
    nextId: () => app.ids.next(),
    voice: app.aiVoice,
    withProvider,
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
  const speaking = input.botToken
    ? createSpeakingBotControl({
        store: app.database,
        voice: app.aiVoice,
        withProvider,
        botToken: input.botToken,
        readActivity: app.redis.readBotActivity,
        timers: input.timers,
        nextId: () => app.ids.next(),
        nowMs: () => Date.parse(app.clock.now()),
        callTimeoutMs: policy.callTimeoutMs,
        failed: () =>
          app.logger.log(
            'round.speaking.failed',
            { operation: 'round.speaking', errorCode: 'INFRASTRUCTURE' },
            'Bot speech stays uncredited',
          ),
      })
    : null;
  const control = startBotControlService({
    store: app.database,
    control: (claim) => {
      const receipts = createBotControl({
        claim,
        store: app.database,
        attendance,
        nextId: () => app.ids.next(),
      });
      return speaking ? speaking(claim, receipts) : receipts;
    },
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
