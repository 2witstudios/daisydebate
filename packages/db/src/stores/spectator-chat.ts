import { spectatorChatOperations } from '../messaging/spectator-chat';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../instrumented';

/** Spectator chat, on the social lane. */
export const createSpectatorChatStore = (resources: DatabaseResources) => {
  const { lane, eventSink } = resourcesOf(resources);
  return namedLaneOperations(
    spectatorChatOperations({ database: lane('social').database, eventSink }),
  );
};
export type SpectatorChatStore = ReturnType<typeof createSpectatorChatStore>;
