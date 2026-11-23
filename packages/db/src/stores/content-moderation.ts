import { contentModerationOperations } from '../content-moderation-operations';
import { roomCommunityModeration } from '../messaging/room-community-moderation';
import { roundFloorModeration } from '../messaging/round-floor-moderation';
import { spectatorChatModeration } from '../messaging/spectator-chat';
import { recordingModeration } from '../recording-moderation';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../workload';

/** The moderation ports each content owner provides; the process passes them in. */
export const contentModerationPorts = {
  chat: spectatorChatModeration,
  floor: roundFloorModeration,
  roomChat: roomCommunityModeration,
  recordings: recordingModeration,
} as const;

/** Operator content moderation over each owner's port, on the control lane. */
export const createContentModerationStore = (
  resources: DatabaseResources,
  ports: Required<
    Pick<
      Parameters<typeof contentModerationOperations>[0],
      'chat' | 'floor' | 'roomChat' | 'recordings'
    >
  >,
) => {
  const { lane, eventSink } = resourcesOf(resources);
  return namedLaneOperations(
    contentModerationOperations({
      database: lane('control').database,
      eventSink,
      ...ports,
    }),
  );
};
export type ContentModerationStore = ReturnType<
  typeof createContentModerationStore
>;
