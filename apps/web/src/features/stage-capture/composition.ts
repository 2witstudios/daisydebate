import { mediaEndpointsOf } from '@daisy/config';
import { createBroadcastEgress } from '@daisy/media/broadcast';
import {
  startSingleFlightWorker,
  type WorkerTimers,
} from '../../lib/worker-timers';
import type { App } from '../../server/app';
import { createStageRoute } from './stage-route';
import { createStrayEgressSweep } from './stray-egress-sweep';

const STRAY_SWEEP_EVERY_MS = 15_000;
const STRAY_CLAIM_MS = 800;

/** The LiveKit and Egress adapter, or null on a deployment with no LiveKit. */
export const stageEgressOf = (app: App) => {
  const {
    LIVEKIT_URL: url,
    LIVEKIT_API_KEY: apiKey,
    LIVEKIT_API_SECRET: apiSecret,
  } = app.config;
  // Staging runs one LiveKit node. A list's first entry until Broadcast follows a
  // room's node (ISSUE filed with the merge of multi-node media).
  return url && apiKey && apiSecret
    ? createBroadcastEgress({
        config: { url: mediaEndpointsOf(url)[0]!, apiKey, apiSecret },
      })
    : null;
};

/**
 * What the stage page reads. A capture id names a Broadcast or a Recording with
 * no Broadcast; each owns its own credential and revocation. Inert unless a
 * capture switch is on, so merging never activates capture.
 */
export const composeStage = (app: App) => {
  const egress = stageEgressOf(app);
  const url = app.config.LIVEKIT_PUBLIC_URL;
  if (
    (app.config.BROADCAST_CAPTURE !== 'on' &&
      app.config.RECORDING_CAPTURE !== 'on') ||
    !egress ||
    !url
  )
    return async () => new Response(null, { status: 404 });
  return createStageRoute({
    store: {
      readStage: async (id) =>
        (await app.database.broadcasts.readStage(id)) ??
        app.database.recordingCaptures.readStage(id),
    },
    observerToken: egress.observerToken,
    livekitUrl: mediaEndpointsOf(url)[0]!,
    now: () => Date.parse(app.clock.now()),
    nextId: () => app.ids.next(),
  });
};

/** Inert unless a capture switch is on, so merging never activates capture. */
export const startStrayEgressSweep = (app: App, timers: WorkerTimers) => {
  const egress = stageEgressOf(app);
  if (
    (app.config.BROADCAST_CAPTURE !== 'on' &&
      app.config.RECORDING_CAPTURE !== 'on') ||
    !egress
  )
    return null;
  const lease = () => {
    const nowMs = Date.parse(app.clock.now());
    return { now: new Date(nowMs), until: new Date(nowMs + STRAY_CLAIM_MS) };
  };
  const report = (event: Parameters<typeof app.logger.log>[0]) =>
    app.logger.log(event, {}, 'Stage capture');
  return startSingleFlightWorker({
    run: createStrayEgressSweep({
      listStages: () => egress.listStages(app.config.PUBLIC_APP_URL),
      stop: egress.stop,
      owners: [
        {
          recordedEgress: app.database.broadcasts.readEgress,
          claim: (id) =>
            app.database.broadcasts.claimReconcile({ id, ...lease() }),
        },
        {
          recordedEgress: app.database.recordingCaptures.readOwnEgress,
          claim: (recordingId) =>
            app.database.recordingCaptures.claimOwn({
              recordingId,
              ...lease(),
            }),
        },
      ],
      report,
    }),
    everyMs: STRAY_SWEEP_EVERY_MS,
    timers,
    failed: () => report('stage.stray_sweep_failed'),
  });
};
