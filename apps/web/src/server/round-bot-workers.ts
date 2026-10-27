import { publicationStopOf } from '@daisy/media/audio';
import type { RoundBotWorkerPolicy } from '@daisy/config';
import type { ErrorReporter } from '@daisy/observability';
import { createAttendanceFeature } from '../features/attendance/operations';
import { createBotControl } from '../features/round-bots/control';
import { startBotControlService } from '../features/round-bots/control-service';
import { createSpeakingBotControl } from '../features/round-bots/speaking';
import type { App } from './app';
import type { createProviderBudget } from './provider-budget';
import { workerFailures } from './recoverable-failure';
import type { WorkerTimers } from './worker-timers';

/** Bot debaters' own workers: seat control and live speech on the competitive provider budget. */
export function startRoundBotWorkers(input: {
  readonly app: App;
  readonly policy: RoundBotWorkerPolicy;
  readonly budget: ReturnType<typeof createProviderBudget>;
  readonly instanceId: string;
  /** Media broker grant; without configured media, seats keep receipts only. */
  readonly botToken:
    Parameters<typeof createSpeakingBotControl>[0]['botToken'] | null;
  readonly timers: WorkerTimers;
  readonly reporter?: ErrorReporter;
}) {
  const { app, policy } = input;
  const failure = workerFailures(app, input.reporter);
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
        withProvider: input.budget,
        botToken: input.botToken,
        readActivity: app.redis.readBotActivity,
        readHeard: app.redis.readCaptureHeard,
        timers: input.timers,
        nextId: () => app.ids.next(),
        nowMs: () => Date.parse(app.clock.now()),
        callTimeoutMs: policy.callTimeoutMs,
        failed: failure(
          'round.speaking.failed',
          'round.speaking',
          'Bot speech stays uncredited',
          // Says whether a publish stopped at a stall or a native failure.
          publicationStopOf,
        ),
      })
    : null;
  return startBotControlService({
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
}
