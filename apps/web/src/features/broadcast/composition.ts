import { createBroadcastEgress } from '@daisy/media/broadcast';
import {
  startSingleFlightWorker,
  type WorkerTimers,
} from '../../lib/worker-timers';
import type { App } from '../../server/app';
import { newStageCredential } from './stage-access';
import { createStageRoute } from './stage-route';
import { createFactLogSweep } from '../spectating/fact-log-sweep';
import { createBroadcastSweep } from './sweep';

const SWEEP_EVERY_MS = 1000;
const FACT_LOG_EVERY_MS = 15_000;

const egressOf = (app: App) => {
  const {
    LIVEKIT_URL: url,
    LIVEKIT_API_KEY: apiKey,
    LIVEKIT_API_SECRET: apiSecret,
  } = app.config;
  return url && apiKey && apiSecret
    ? createBroadcastEgress({ config: { url, apiKey, apiSecret } })
    : null;
};

/** Inert unless BROADCAST_CAPTURE is on, so merging never activates capture. */
export const startBroadcastSweep = (app: App, timers: WorkerTimers) => {
  const egress = egressOf(app);
  if (app.config.BROADCAST_CAPTURE !== 'on' || !egress) return null;
  const log = (event: Parameters<typeof app.logger.log>[0]) =>
    app.logger.log(event, {}, 'Broadcast control plane');
  const sweep = createBroadcastSweep({
    store: app.database.broadcasts,
    egress,
    now: () => Date.parse(app.clock.now()),
    nextId: () => app.ids.next(),
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

export const composeBroadcastStage = (app: App) => {
  const egress = egressOf(app);
  const url = app.config.LIVEKIT_PUBLIC_URL;
  if (app.config.BROADCAST_CAPTURE !== 'on' || !egress || !url)
    return async () => new Response(null, { status: 404 });
  return createStageRoute({
    store: app.database.broadcasts,
    observerToken: egress.observerToken,
    livekitUrl: url,
    now: () => Date.parse(app.clock.now()),
    nextId: () => app.ids.next(),
  });
};
