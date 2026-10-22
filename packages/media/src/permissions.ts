import { TrackSource } from 'livekit-server-sdk';
import { participantSchema, type MediaPermissions } from './contracts';
import type { z } from 'zod';

const trackSources = {
  camera: TrackSource.CAMERA,
  microphone: TrackSource.MICROPHONE,
} as const;
/** Empty allowed sources must explicitly disable the vendor's publish default. */
export function vendorPermissions(grants: MediaPermissions) {
  return {
    canPublish: grants.publish.length > 0,
    canSubscribe: grants.subscribe,
    canPublishData: false,
    canPublishSources: grants.publish.map((source) => trackSources[source]),
    canUpdateOwnMetadata: false,
    hidden: grants.capture || grants.hidden === true,
  };
}

/** Room-service permission names differ from the JWT video grant vocabulary. */
export function roomPermissions(grants: MediaPermissions) {
  const { canUpdateOwnMetadata, ...permission } = vendorPermissions(grants);
  return { ...permission, canUpdateMetadata: canUpdateOwnMetadata };
}

/** Normalized adapter read: unknown/empty unrestricted source defaults require replacement. */
export function publicationPermission(
  participant: z.infer<typeof participantSchema>,
) {
  const permission = participant.permission;
  const sources = permission.canPublishSources;
  const publish: ('camera' | 'microphone')[] = [];
  if (permission.canPublish && sources.includes(TrackSource.CAMERA))
    publish.push('camera');
  if (permission.canPublish && sources.includes(TrackSource.MICROPHONE))
    publish.push('microphone');
  return {
    identity: participant.identity,
    grants: {
      publish,
      subscribe: permission.canSubscribe,
      hidden: permission.hidden,
      capture: false as const,
    },
    restricted:
      !permission.canPublishData &&
      !permission.canUpdateMetadata &&
      (!permission.canPublish ||
        (sources.length > 0 &&
          sources.every(
            (source) =>
              source === TrackSource.CAMERA ||
              source === TrackSource.MICROPHONE,
          ))),
  };
}
