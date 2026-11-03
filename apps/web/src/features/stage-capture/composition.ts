import { mediaEndpointsOf } from '@daisy/config';
import {
  broadcastEgressOnNodes,
  createBroadcastEgress,
} from '@daisy/media/broadcast';
import { createMediaNodes } from '@daisy/media';
import {
  startSingleFlightWorker,
  type WorkerTimers,
} from '../../lib/worker-timers';
import type { App } from '../../server/app';
import { createStageRoute } from './stage-route';
import { createStrayEgressSweep } from './stray-egress-sweep';

const STRAY_SWEEP_EVERY_MS = 15_000;
const STRAY_CLAIM_MS = 800;

const MEDIA_NODE_PROBE_MS = 5_000;

const stageMedia = new WeakMap<App, ReturnType<typeof composeStageMedia>>();

/**
 * Capture's own view of the media nodes: which are up, and an Egress client for each
 * (ISSUE-1299). Null on a deployment with no LiveKit. One node has nowhere to fail
 * over to, so it pays for no probe. The timer never holds the process open.
 */
const composeStageMedia = (app: App) => {
  const {
    LIVEKIT_URL: url,
    LIVEKIT_PUBLIC_URL: publicUrl,
    LIVEKIT_API_KEY: apiKey,
    LIVEKIT_API_SECRET: apiSecret,
  } = app.config;
  if (!url || !publicUrl || !apiKey || !apiSecret) return null;
  const urls = mediaEndpointsOf(url);
  const publicUrls = mediaEndpointsOf(publicUrl);
  const nodes = createMediaNodes({
    nodes: urls.map((entry, index) => ({
      url: entry,
      publicUrl: publicUrls[index]!,
    })),
    apiKey,
    apiSecret,
    fetch,
    healthChanged: (nodeIndex, healthy) =>
      app.logger.log(
        'stage.media.node_health',
        { nodeIndex, cause: healthy ? 'up' : 'down' },
        'A media node changed health',
      ),
  });
  if (nodes.size > 1) {
    void nodes.probe();
    setInterval(() => void nodes.probe(), MEDIA_NODE_PROBE_MS).unref();
  }
  return {
    nodes,
    egress: broadcastEgressOnNodes({
      egresses: urls.map((entry) =>
        createBroadcastEgress({ config: { url: entry, apiKey, apiSecret } }),
      ),
      order: nodes.order,
    }),
  };
};

const stageMediaOf = (app: App) => {
  if (!stageMedia.has(app)) stageMedia.set(app, composeStageMedia(app));
  return stageMedia.get(app)!;
};

/** The LiveKit and Egress adapter, or null on a deployment with no LiveKit. */
export const stageEgressOf = (app: App) => stageMediaOf(app)?.egress ?? null;

/**
 * What the stage page reads. A capture id names a Broadcast or a Recording with
 * no Broadcast; each owns its own credential and revocation. Inert unless a
 * capture switch is on, so merging never activates capture.
 */
export const composeStage = (app: App) => {
  const media = stageMediaOf(app);
  if (
    (app.config.BROADCAST_CAPTURE !== 'on' &&
      app.config.RECORDING_CAPTURE !== 'on') ||
    !media
  )
    return async () => new Response(null, { status: 404 });
  return createStageRoute({
    store: {
      readStage: async (id) =>
        (await app.database.broadcasts.readStage(id)) ??
        app.database.recordingCaptures.readStage(id),
    },
    observerToken: media.egress.observerToken,
    livekitUrlFor: (room) => media.nodes.urlsFor(room).publicUrl,
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
