import {
  startSingleFlightWorker,
  type WorkerTimers,
} from '../../lib/worker-timers';
import type { App } from '../../server/app';
import { newFeedKey } from './official-feed';
import { stageEgressOf } from '../stage-capture/composition';
import { newStageCredential } from '../stage-capture/stage-access';
import { createFactLogSweep } from '../spectating/fact-log-sweep';
import { createBroadcastSweep } from './sweep';

const SWEEP_EVERY_MS = 1000;
const FACT_LOG_EVERY_MS = 15_000;

/** Inert unless BROADCAST_CAPTURE is on, so merging never activates capture. */
export const startBroadcastSweep = (app: App, timers: WorkerTimers) => {
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
  });
  const factLog = startSingleFlightWorker({
    run: createFactLogSweep({
      store: app.database,
      now: () => app.clock.now(),
    }),
    everyMs: FACT_LOG_EVERY_MS,
    timers,
    failed: () => log('spectator.fact_log_failed'),
  });
  const reconcile = startSingleFlightWorker({
    run: sweep,
    everyMs: SWEEP_EVERY_MS,
    timers,
    failed: () => log('broadcast.reconcile_failed'),
  });
  return {
    stop: () => Promise.all([factLog.stop(), reconcile.stop()]),
  };
};

