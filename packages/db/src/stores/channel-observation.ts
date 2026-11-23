import { channelObservationReads } from '../messaging/observation-reads';
export type { ChannelObservationReads } from '../messaging/observation-reads';
import { resourcesOf } from '../resource-handles';
import type { DatabaseResources } from '../resources';
import { namedLaneOperations } from '../workload';

/**
 * Channel observation owner reads (ADR 0089), only on a profile that
 * reserves the headers and projection lanes; null on a fanout-only process.
 */
export const createChannelObservationStore = (resources: DatabaseResources) => {
  const { lane, profile } = resourcesOf(resources);
  return namedLaneOperations({
    observation:
      profile.lanes.headers && profile.lanes.projection
        ? {
            headers: channelObservationReads(lane('headers').database),
            projection: channelObservationReads(lane('projection').database),
          }
        : null,
  });
};
export type ChannelObservationStore = ReturnType<
  typeof createChannelObservationStore
>;
