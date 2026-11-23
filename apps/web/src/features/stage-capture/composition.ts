import { defineComposition } from '../../server/composition';
import type { Waits } from '@daisy/clock';
import { passOf, pollWork, repeatEvery } from '@daisy/worker';
import { HOUSEKEEPING_IDLE_MAX_MS } from '../../lib/worker-idle';
import { nowMs as clockNowMs } from '@daisy/clock';
import { mediaEndpointsOf } from '@daisy/config';
import {
  broadcastEgressOnNodes,
  createBroadcastEgress,
} from '@daisy/media/broadcast';
import { createMediaNodes } from '@daisy/media';
import { heldKey, type App } from '../../server/app';
import { createStageRoute } from './stage-route';
import { createStrayEgressSweep } from './stray-egress-sweep';

const STRAY_SWEEP_EVERY_MS = 15_000;
const STRAY_CLAIM_MS = 800;

const MEDIA_NODE_PROBE_MS = 5_000;

/**
 * Capture's own view of the media nodes: which are up, and an Egress client for each
 * (ISSUE-1299). Null on a deployment with no LiveKit. One node has nowhere to fail
 * over to, so it pays for no probe. The probe runs on `waits` until `stop`.
 */
const composeStageMedia = (app: App, waits: Waits) => {
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
    waits,
    healthChanged: (nodeIndex, healthy) =>
      app.logger.log(
        'stage.media.node_health',
        { nodeIndex, cause: healthy ? 'up' : 'down' },
        'A media node changed health',
      ),
  });
  const probe =
    nodes.size > 1
      ? repeatEvery({
          waits,
          everyMs: MEDIA_NODE_PROBE_MS,
          runOnStart: true,
          run: () => nodes.probe(),
          // A probe settles every node's fault as down; only a throwing
          // health log rejects it, and the next run logs again.
          failed: () => {},
        })
      : null;
  return {
    nodes,
    stop: async () => {
      await probe?.stop();
    },
    egress: broadcastEgressOnNodes({
      egresses: urls.map((entry) =>
        createBroadcastEgress({ config: { url: entry, apiKey, apiSecret } }),
      ),
      order: nodes.order,
    }),
  };
};

/** One stage media per app, its probe on the first caller's `waits`. */
const STAGE_MEDIA = heldKey<ReturnType<typeof composeStageMedia>>(
  'stage-capture/media',
);

const stageMediaOf = (app: App, waits: Waits) =>
  app.held(STAGE_MEDIA, () => composeStageMedia(app, waits));

/** The LiveKit and Egress adapter, or null on a deployment with no LiveKit. */
export const stageEgressOf = (app: App, waits: Waits) =>
  stageMediaOf(app, waits)?.egress ?? null;

/**
 * Stops the app's stage media node probe, if one runs; the process's
 * shutdown awaits it. Later reads compose no new probe for this app.
 */
export const stopStageMedia = async (app: App): Promise<void> => {
  await app.heldIfAny(STAGE_MEDIA)?.stop();
};

/**
 * What the stage page reads. A capture id names a Broadcast or a Recording with
 * no Broadcast; each owns its own credential and revocation. Inert unless a
 * capture switch is on, so merging never activates capture.
 */
const composeStage = (app: App, waits: Waits) => {
  const media = stageMediaOf(app, waits);
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
    now: () => clockNowMs(app.clock),
    nextId: () => app.ids.next(),
  });
};

/** Inert unless a capture switch is on, so merging never activates capture. */
export const startStrayEgressSweep = (app: App, waits: Waits) => {
  const egress = stageEgressOf(app, waits);
  if (
    (app.config.BROADCAST_CAPTURE !== 'on' &&
      app.config.RECORDING_CAPTURE !== 'on') ||
    !egress
  )
    return null;
  const lease = () => {
    const nowMs = clockNowMs(app.clock);
    return { now: new Date(nowMs), until: new Date(nowMs + STRAY_CLAIM_MS) };
  };
  const report = (event: Parameters<typeof app.logger.log>[0]) =>
    app.logger.log(event, {}, 'Stage capture');
  const sweep = createStrayEgressSweep({
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
  });
  return pollWork({
    pass: () => sweep().then(passOf),
    backoff: {
      busyMs: STRAY_SWEEP_EVERY_MS,
      idleMaxMs: HOUSEKEEPING_IDLE_MAX_MS,
    },
    waits,
    failed: () => report('stage.stray_sweep_failed'),
  });
};

/** stage: its route files bind here (`processRoute`). */
export const stageComposition = defineComposition('stage', (app) =>
  composeStage(app, app.waits),
);
