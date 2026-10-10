import { TrackSource } from 'livekit-server-sdk';
import type { MediaPermissions } from './contracts';

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
