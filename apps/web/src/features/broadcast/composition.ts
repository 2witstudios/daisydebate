import type { WorkerTimers } from '../../lib/worker-timers';
import { passOf } from '../../lib/idle-backoff';
import {
  LIVE_IDLE_MAX_MS,
  startWorkerLoop,
  type WorkWake,
} from '../../lib/worker-loop';
import type { App } from '../../server/app';
import { newFeedKey } from './official-feed';
import { stageEgressOf } from '../stage-capture/composition';
import { newStageCredential } from '../stage-capture/stage-access';
import { createFactLogSweep } from '../spectating/fact-log-sweep';
import { createBroadcastSweep } from './sweep';

const SWEEP_EVERY_MS = 1000;
const FACT_LOG_EVERY_MS = 15_000;
/** A slow Broadcast runs on past this; the next pass reaches the others on time. */
const PASS_BUDGET_MS = 750;

/** Inert unless BROADCAST_CAPTURE is on, so merging never activates capture. */
export const startBroadcastSweep = (
  app: App,
  timers: WorkerTimers,
  /** A Round changed: one may need a Broadcast now (ADR 0154). */
  wake?: WorkWake,
) => {
  const egress = stageEgressOf(app);
  if (app.config.BROADCAST_CAPTURE !== 'on' || !egress) return null;
  const log = (event: Parameters<typeof app.logger.log>[0]) =>
    app.logger.log(event, {}, 'Broadcast control plane');
  const sweep = createBroadcastSweep({
    store: app.database.broadcasts,
    egress,
    now: () => Date.parse(app.clock.now()),
    nextId: () => app.ids.next(),
    newFeedKey: () => newFeedKey(),
    newCredential: () => newStageCredential(),
    stageUrl: (id, credential) =>
      `${app.config.PUBLIC_APP_URL}/stage/${id}?c=${encodeURIComponent(credential)}`,
    report: log,
    passBudget: () => Bun.sleep(PASS_BUDGET_MS),
  });
  const factLogSweep = createFactLogSweep({
    store: app.database,
    now: () => app.clock.now(),
  });
  const factLog = startWorkerLoop({
    run: () => factLogSweep().then(passOf),
    // A fixed cadence: a fact leaves by the spectator clock, not a command,
    // and its release time must be no later than one pass after (BCAST-5).
    backoff: { busyMs: FACT_LOG_EVERY_MS, idleMaxMs: FACT_LOG_EVERY_MS },
    timers,
    failed: () => log('spectator.fact_log_failed'),
  });
  const reconcile = startWorkerLoop({
    run: sweep,
    backoff: { busyMs: SWEEP_EVERY_MS, idleMaxMs: LIVE_IDLE_MAX_MS },
    timers,
    failed: () => log('broadcast.reconcile_failed'),
    wake,
  });
  return {
    stop: () =>
      Promise.all([factLog.stop(), reconcile.stop()]).then(sweep.settled),
  };
};
