import { createBroadcastEgress } from '@daisy/media/broadcast';
import type { App } from '../../server/app';
import { createStageRoute } from './stage-route';

/** The LiveKit and Egress adapter, or null on a deployment with no LiveKit. */
export const stageEgressOf = (app: App) => {
  const {
    LIVEKIT_URL: url,
    LIVEKIT_API_KEY: apiKey,
    LIVEKIT_API_SECRET: apiSecret,
  } = app.config;
  return url && apiKey && apiSecret
    ? createBroadcastEgress({ config: { url, apiKey, apiSecret } })
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
    livekitUrl: url,
    now: () => Date.parse(app.clock.now()),
    nextId: () => app.ids.next(),
  });
};
