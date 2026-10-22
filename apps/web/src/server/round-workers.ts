import type { EventName } from '@daisy/logger';
import { noopErrorReporter, type ErrorReporter } from '@daisy/observability';
import { recoverableFailure } from './recoverable-failure';
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
  /** Scrubbed raw-error destination (ADR 0037); inert until configured. */
  readonly reporter?: ErrorReporter;
}) {
  const { app } = input;
  const policy = app.config.ROUND_BOT_WORKER_POLICY;
  if (!policy) return null;
  const failure = (event: EventName, operation: string, message: string) =>
    recoverableFailure({
      logger: app.logger,
      reporter: input.reporter ?? noopErrorReporter,
      nextId: () => app.ids.next(),
      event,
      operation,
      message,
    });
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
    failed: failure(
      'round.judging.failed',
      'round.judging',
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
        failed: failure(
          'round.speaking.failed',
          'round.speaking',
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
    failed: failure(
      'round.control.failed',
      'round.control',
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
